/**
 * Basic parser for HTTP-based HAP event messages.
 */
'use strict';

const EventEmitter = require('events');

const State = {
  EMPTY: 0,
  REQUEST_LINE_COMPLETE: 1,
  HEADERS_COMPLETE: 2,
};

const HEADER_SUFFIX = '\r\n\r\n';

class HttpEventParser extends EventEmitter {
  /**
   * Initialize the HttpEventParser object.
   */
  constructor() {
    super();
    this._pending = Buffer.alloc(0);
    this._reset();
  }

  /**
   * Execute parser on a chunk of data.
   *
   * @param {Buffer} data - Chunk of data
   */
  execute(data) {
    this._pending = Buffer.concat([this._pending, data]);

    while (this._pending.length > 0) {
      switch (this._state) {
        case State.EMPTY: {
          const crlf = this._pending.indexOf('\r\n');
          if (crlf < 0) {
            return;
          }

          const requestLine = this._pending.slice(0, crlf).toString();
          this._pending = this._pending.slice(crlf + 2, this._pending.length);

          let parts = requestLine.split(' ');
          this.statusCode = parseInt(parts[1], 10);
          this.statusMessage = parts.slice(2).join(' ');

          parts = parts[0].split('/', 2);
          this.protocol = parts[0];
          this.version = parts[1];

          this._state = State.REQUEST_LINE_COMPLETE;
          break;
        }
        case State.REQUEST_LINE_COMPLETE: {
          const end = this._pending.indexOf(HEADER_SUFFIX);
          if (end < 0) {
            return;
          }

          const headers = this._pending.slice(0, end).toString();
          this._pending = this._pending.slice(end + 4, this._pending.length);

          const lines = headers.split('\r\n');
          for (const line of lines) {
            const idx = line.indexOf(':');
            if (idx > 0) {
              const name = line.substring(0, idx).trim();
              const value = line.substring(idx + 1, line.length).trim();

              this.headers[name.toLowerCase()] = value;
            }
          }

          if (parseInt(this.headers['content-length'], 10) === 0) {
            this._reset();
          } else {
            this._state = State.HEADERS_COMPLETE;
          }
          break;
        }
        case State.HEADERS_COMPLETE: {
          if (typeof this.headers['content-length'] !== 'undefined') {
            const contentLength = parseInt(this.headers['content-length'], 10);
            const toCopy = Math.min(
              contentLength - this.body.length,
              this._pending.length
            );
            this.body = Buffer.concat([
              this.body,
              this._pending.slice(0, toCopy),
            ]);
            this._pending = this._pending.slice(toCopy, this._pending.length);
            if (this.body.length === contentLength &&
                this.protocol === 'EVENT') {
              this.emit('event', this.body);
              this._reset();
            }
          } else if (typeof this.headers['content-type'] !== 'undefined') {
            const prefix = `0${HEADER_SUFFIX}`;
            if (this._pending.indexOf(
              prefix,
              this._pending.length - prefix.length
            ) !== -1) {
              this.body = this._pending.toString('utf8');
              const firstPosition = this.body.indexOf('{');
              const lastPosition = this.body.lastIndexOf('}');
              this.body = this.body.substr(
                firstPosition,
                lastPosition - firstPosition + 1
              );

              if (this.body.length > 0 && this.protocol === 'EVENT') {
                this.emit('event', this.body);
                this._pending = Buffer.alloc(0);
                this._reset();
              }
            }
            return;
          }

          break;
        }
      }
    }
  }

  /**
   * Reset the internal parser state.
   */
  _reset() {
    this.protocol = null;
    this.version = null;
    this.statusCode = null;
    this.statusMessage = null;
    this.headers = {};
    this.body = Buffer.alloc(0);
    this._state = State.EMPTY;
  }
}

module.exports = HttpEventParser;
