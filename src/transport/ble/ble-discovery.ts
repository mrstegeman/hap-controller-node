/**
 * BLE discovery wrappers for finding HAP devices.
 */

import { EventEmitter } from 'events';
import noble from '@abandonware/noble';

export interface HapService {
  name: string;
  CoID: number;
  TY: number;
  AIL: number;
  SF: number;
  DeviceID: string;
  ACID: number;
  GSN: number;
  CN: number;
  CV: number;
  peripheral: noble.Peripheral;
}

export default class BLEDiscovery extends EventEmitter {
  private scanEnabled: boolean;

  private allowDuplicates: boolean;

  private services: Map<string, HapService>;

  private handleStateChange: (state: string) => void;

  private handleDiscover: (peripheral: noble.Peripheral) => void;

  private handleScanStart: () => void;

  private handleScanStop: () => void;

  constructor() {
    super();

    this.scanEnabled = false;
    this.allowDuplicates = false;

    this.services = new Map();

    this.handleStateChange = this._handleStateChange.bind(this);
    this.handleDiscover = this._handleDiscover.bind(this);
    this.handleScanStart = this._handleScanStart.bind(this);
    this.handleScanStop = this._handleScanStop.bind(this);
  }

  /**
   * Start searching for BLE HAP devices.
   *
   * @param {boolean} allowDuplicates - Allow duplicate serviceUp events. This
   *                  is needed for disconnected events, where the GSN is
   *                  updated in the advertisement.
   */
  start(allowDuplicates = false): void {
    this.scanEnabled = true;
    this.allowDuplicates = allowDuplicates;

    noble.on('stateChange', this.handleStateChange);
    noble.on('scanStart', this.handleScanStart);
    noble.on('scanStop', this.handleScanStop);
    noble.on('discover', this.handleDiscover);

    // Only manually start if powered on already. Otherwise, wait for state
    // change and handle it there.
    if ((<{ _state: string }>(<unknown>noble))._state === 'poweredOn') {
      noble.startScanning([], this.allowDuplicates);
    }
  }

  /**
   * List the currently known services.
   *
   * @returns {Object[]} Array of services
   */
  list(): HapService[] {
    return Array.from(this.services.values());
  }

  /**
   * Stop an ongoing discovery process.
   */
  stop(): void {
    noble.stopScanning();
    noble.removeListener('stateChange', this.handleStateChange);
    noble.removeListener('scanStart', this.handleScanStart);
    noble.removeListener('scanStop', this.handleScanStop);
    noble.removeListener('discover', this.handleDiscover);
  }

  private _handleStateChange(state: string): void {
    if (state === 'poweredOn' && this.scanEnabled) {
      noble.startScanning([], this.allowDuplicates);
    } else {
      noble.stopScanning();
    }
  }

  private _handleScanStart(): void {
    if (!this.scanEnabled) {
      noble.stopScanning();
    }
  }

  private _handleScanStop(): void {
    if (this.scanEnabled) {
      noble.startScanning([], this.allowDuplicates);
    }
  }

  private _handleDiscover(peripheral: noble.Peripheral): void {
    const advertisement = peripheral.advertisement;
    const manufacturerData = advertisement.manufacturerData;

    if (
      !advertisement ||
      !advertisement.localName ||
      !manufacturerData ||
      manufacturerData.length < 17
    ) {
      return;
    }

    // See Chapter 6.4.2.2
    const localName = advertisement.localName;
    const CoID = manufacturerData.readUInt16LE(0);
    const TY = manufacturerData.readUInt8(2);
    const AIL = manufacturerData.readUInt8(3);
    const SF = manufacturerData.readUInt8(4);
    const deviceID = manufacturerData.slice(5, 11);
    const ACID = manufacturerData.readUInt16LE(11);
    const GSN = manufacturerData.readUInt16LE(13);
    const CN = manufacturerData.readUInt8(15);
    const CV = manufacturerData.readUInt8(16);

    if (CoID !== 0x4c || TY !== 0x06 || CV !== 0x02) {
      return;
    }

    let formattedId = '';
    for (const b of deviceID) {
      formattedId += `${b.toString(16).padStart(2, '0')}:`;
    }
    formattedId = formattedId.substr(0, 17);

    const service = {
      name: localName,
      CoID,
      TY,
      AIL,
      SF,
      DeviceID: formattedId,
      ACID,
      GSN,
      CN,
      CV,
      peripheral,
    };

    this.services.set(service.DeviceID, service);
    this.emit('serviceUp', service);
  }
}
