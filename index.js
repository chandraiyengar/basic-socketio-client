class EventEmitter {
  #listeners = new Map();

  on(event, listener) {
    let listeners = this.#listeners.get(event);
    if (!listeners) {
      this.#listeners.set(event, listeners = []);
    }
    listeners.push(listener);
  }

  emit(event, ...args) {
    const listeners = this.#listeners.get(event);
    if (listeners) {
      for (const listener of listeners) {
        listener.apply(null, args);
      }
    }
  }
}

class Socket extends EventEmitter {
  #uri;
  #opts;
  #ws;
  #pingTimeoutTimer;
  #pingTimeoutDelay;

  constructor(uri, opts) {
    super();
    this.#uri = uri;
    this.#opts = Object.assign({
      path: "/socket.io/",
      reconnectionDelay: 2000,
    }, opts);
    this.#open();
  }

  #open() {
    this.#ws = new WebSocket(this.#createUrl());
    this.#ws.onmessage = ({ data }) => this.#onMessage(data);
    this.#ws.onclose = () => this.#onClose("transport close");
  }

  #onMessage(data) {
    if (typeof data !== "string") {
      //TODO: binary payloads?...
      return;
    }

    switch (data[0]) {
      case EIOPacketType.OPEN:
        this.#onOpen(data);
        break;

      case EIOPacketType.CLOSE:
        this.#onClose("transport close");
        break;
      
      case EIOPacketType.PING:
        this.#resetPingTimeout();
        this.#send(EIOPacketType.PONG);
        break;

      default:
        this.#onClose("parse error");
        break;
    }
  }

  #onOpen(data) {
    let handshake;
    try {
      handshake = JSON.parse(data.substring(1));
    } catch(e) {
      return this.#onClose("parse error");
    }
    this.#pingTimeoutDelay = handshake.pingInterval + handshake.pingTimeout;
    this.#resetPingTimeout();
  }

  #resetPingTimeout() {
    clearTimeout(this.#pingTimeoutTimer);
    this.#pingTimeoutTimer = setTimeout(() => {
      this.#onClose("ping timeout");

    }, this.#pingTimeoutDelay);
  }

  #send(data) {
    if (this.#ws.readyState === WebSocket.OPEN) {
      this.#ws.send(data);
    }
  }

  #onClose(reason) {
    if (this.#ws) {
      this.#ws.onclose = noop;
      this.#ws.close();
    }

    clearTimeout(this.#pingTimeoutTimer);

    setTimeout(() => this.#open(), this.#opts.reconnectionDelay);
  }

  #createUrl() {
    const uri = this.#uri.replace(/^http/, "ws");
    const queryParams = "?EIO=4&transport=websocket";
    return `${uri}${this.#opts.path}${queryParams}`;
  }
}

const EIOPacketType = {
  OPEN: "0",
  CLOSE: "1",
  PING: "2",
  PONG: "3",
  MESSAGE: "4",
};

function noop() {}

export function io(uri, opts) {
  if (typeof uri !== 'string') {
    opts = uri;
    uri = location.origin;
  }
  return new Socket(uri, opts);
}