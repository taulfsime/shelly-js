import {
  shelly_rpc_method_params_t,
  shelly_rpc_method_response_t,
  shelly_rpc_method_result_t,
  shelly_rpc_method_t,
  shelly_rpc_notification_event_t,
  shelly_rpc_notification_status_t,
  shelly_rpc_request_id_t,
  shelly_rpc_request_t,
} from '../types/ShellyRpc';

export class ShellyRpc {
  private clientId: string;
  private msgCounter: number = 1;
  private requestQueue: {
    params: shelly_rpc_request_t<any>;
    resolve: (response: shelly_rpc_method_result_t<any>) => void;
    reject: (reason: ErrorShellyRpc) => void;
  }[] = [];
  private responseQueue: Map<
    shelly_rpc_request_id_t,
    (response: shelly_rpc_method_response_t<any>) => void
  > = new Map();

  private limitRequestsInFlight: number = 1;

  constructor(
    clientId: string,
    options?: {
      limitRequestsInFlight?: number;
    }
  ) {
    this.clientId = clientId;

    if (options?.limitRequestsInFlight) {
      this.limitRequestsInFlight = Math.max(
        options.limitRequestsInFlight,
        this.limitRequestsInFlight
      );
    }
  }

  async rpcRequest<T extends shelly_rpc_method_t = any>(
    method: T,
    params: shelly_rpc_method_params_t<T>
  ): Promise<shelly_rpc_method_result_t<T>> {
    await this.connected;

    const id = this.msgCounter++;
    const requestParams: shelly_rpc_request_t<T> = {
      jsonrpc: '2.0',
      id,
      method,
      params,
      src: this.clientId,
    };

    const responsePromise = new Promise<shelly_rpc_method_result_t<T>>(
      (resolve, reject) => {
        this.requestQueue.push({
          params: requestParams,
          resolve,
          reject,
        });
        this.processRequestQueue();
      }
    );

    return responsePromise;
  }

  protected onMessageReceive(
    msg:
      | shelly_rpc_notification_status_t
      | shelly_rpc_notification_event_t
      | shelly_rpc_method_response_t<any>
  ): void {
    if (
      'id' in msg &&
      msg.dst === this.clientId &&
      this.responseQueue.has(msg.id)
    ) {
      const callback = this.responseQueue.get(msg.id);
      this.responseQueue.delete(msg.id);

      if (typeof callback === 'function') {
        callback(msg);
      }
    }
  }

  get connected(): Promise<void> {
    return Promise.resolve(); // dummy implementation, always connected
  }

  protected onMessageSend(msg: shelly_rpc_request_t<any>): void {
    // dummy implementation, message send is not implemented.
    this.onMessageReceive({
      dst: msg.src,
      src: this.clientId,
      id: msg.id,
      error: {
        code: -999,
        message: 'Sending message is not implemented',
      },
    });
  }

  private processRequestQueue(): void {
    if (this.responseQueue.size > this.limitRequestsInFlight) {
      return;
    }

    const msg = this.requestQueue.shift();
    if (!msg) {
      return;
    }

    this.responseQueue.set(
      msg.params.id,
      (msgContent: shelly_rpc_method_response_t<any>) => {
        if ('error' in msgContent) {
          msg.reject(
            new ErrorShellyRpc(msgContent.error.code, msgContent.error.message)
          );
        }

        if ('result' in msgContent) {
          msg.resolve(msgContent.result);
        }

        this.processRequestQueue();
      }
    );

    this.onMessageSend(msg.params);
    this.processRequestQueue();
    // TODO: (k.todorov) add timeout
  }
}

export class ErrorShellyRpc extends Error {
  private _code: number;
  private _message: string;

  constructor(code: number, message: string) {
    super(`RPC error: ${message} (code: ${code})`);
    this._code = code;
    this._message = message;
  }

  get code(): number {
    return this._code;
  }

  get message(): string {
    return this._message;
  }
}
