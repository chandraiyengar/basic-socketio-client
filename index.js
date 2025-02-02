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

const SIOPacketType = {
  CONNECT: 0,
  DISCONNECT: 1,
  EVENT:  2,
};

class Socket extends EventEmitter {
  #uri;
  #opts;
  #ws;
  #pingTimeoutTimer;
  #pingTimeoutDelay;
  #reconnectTimer;
  #shouldReconnect = true;
  #sendBuffer = [];
  id;
  connected = false;

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

      case EIOPacketType.MESSAGE:
        let packet;
        try {
          packet = decode(data);
        } catch(e) {
          return this.#onClose("parse error");
        }
        this.#onPacket(packet);
        break;

      default:
        this.#onClose("parse error");
        break;
    }
  }

  #onPacket(packet) {
    switch (packet.type) {
      case SIOPacketType.CONNECT:
        this.#onConnect(packet);
        break;

      case SIOPacketType.DISCONNECT:
        this.#shouldReconnect = false;
        this.#onClose("io server disconnect");
        break;

      case SIOPacketType.EVENT:
        super.emit.apply(this, packet.data);
        break;
    }
  }

  #onConnect(packet) {
    this.id = packet.data.sid;
    this.connected = true;

    this.#sendBuffer.forEach((packet) => this.#sendPacket(packet));
    this.#sendBuffer.slice(0);

    super.emit("connect");
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
    this.#doConnect();
  }

  #doConnect() {
    this.#sendPacket({ type: SIOPacketType.CONNECT });
  }
  
  #sendPacket(packet) {
    this.#send(EIOPacketType.MESSAGE + encode(packet));
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
    clearTimeout(this.#reconnectTimer);

    if (this.#shouldReconnect) {
      this.#reconnectTimer = setTimeout(
        () => this.#open(),
        this.#opts.reconnectionDelay
      );
    }
  }

  disconnect() {
    this.#shouldReconnect = false;
    this.#onClose("io client disconnect");
  }

  #createUrl() {
    const uri = this.#uri.replace(/^http/, "ws");
    const queryParams = "?EIO=4&transport=websocket";
    return `${uri}${this.#opts.path}${queryParams}`;
  }

  emit(...args) {
    const packet = {
      type: SIOPacketType.EVENT,
      data: args,
    };

    if (this.connected) {
      this.#sendPacket(protocol);
    } else {
      this.#sendBuffer.push(packet);
    }
  }
}
function decode(data) {
  let i = 1;

  const packet = {
    type: parseInt(data.charAt(i++), 10),
  };

  if (data.charAt(i)) {
    packet.data = JSON.parse(data.substring(i));
  }

  if (!isPacketValid(packet)) {
    throw new Error("invalid format");
  }

  return packet;
}

function encode(packet) {
  let output = "" + packet.type;

  if (packet.data) {
    output += JSON.stringify(packet.data);
  }

  return output;
}

function isPacketValid(packet) {
  switch (packet.type) {
    case SIOPacketType.CONNECT:
      return typeof packet.data === "object";
    case SIOPacketType.DISCONNECT:
      return packet.data === undefined;
    case SIOPacketType.EVENT:
      const args = packet.data;
      return (
        Array.isArray(args) && args.length > 0 && typeof args[0] === "string"
      );
    default:
      return false;
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