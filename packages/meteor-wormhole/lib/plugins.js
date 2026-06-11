import { WebApp } from 'meteor/webapp';

/**
 * PluginHost — manages Wormhole plugins.
 *
 * A plugin is an object:
 *   {
 *     name: string,
 *     start(api): void|Promise<void>,
 *     stop?(): void|Promise<void>,
 *   }
 *
 * The `api` passed to start() exposes:
 *   - registry: the MethodRegistry (read/register methods)
 *   - options:  the resolved Wormhole init options
 *   - context:  app-provided context (auth resolvers, audit, storage, ...)
 *   - mount(path, handler): mount a connect-style handler on the web server
 */
export class PluginHost {
  constructor() {
    this._plugins = [];
    this._api = null;
  }

  /**
   * Register a plugin. If the host has already started, the plugin
   * is started immediately.
   * @param {{name: string, start: Function, stop?: Function}} plugin
   */
  use(plugin) {
    if (!plugin || typeof plugin.start !== 'function' || typeof plugin.name !== 'string') {
      throw new Error('Wormhole plugin must be an object with { name: string, start: Function }');
    }
    if (this._plugins.some((p) => p.name === plugin.name)) {
      throw new Error(`Wormhole plugin "${plugin.name}" is already registered`);
    }
    this._plugins.push(plugin);
    if (this._api) {
      this._startPlugin(plugin);
    }
  }

  /**
   * Start all registered plugins with the given host API.
   * @param {{registry: object, options: object, context: object}} api
   */
  startAll(api) {
    this._api = {
      ...api,
      mount: (path, handler) => {
        WebApp.connectHandlers.use(path, handler);
      },
    };
    for (const plugin of this._plugins) {
      this._startPlugin(plugin);
    }
  }

  /** Stop all plugins (reverse order) and reset host state. */
  async stopAll() {
    for (const plugin of [...this._plugins].reverse()) {
      if (typeof plugin.stop === 'function') {
        try {
          await plugin.stop();
        } catch (err) {
          console.error(`[Wormhole] Error stopping plugin "${plugin.name}":`, err);
        }
      }
    }
    this._plugins = [];
    this._api = null;
  }

  names() {
    return this._plugins.map((p) => p.name);
  }

  _startPlugin(plugin) {
    try {
      const result = plugin.start(this._api);
      if (result && typeof result.then === 'function') {
        result.catch((err) => {
          console.error(`[Wormhole] Plugin "${plugin.name}" failed to start:`, err);
        });
      }
      console.info(`[Wormhole] Plugin "${plugin.name}" started`);
    } catch (err) {
      console.error(`[Wormhole] Plugin "${plugin.name}" failed to start:`, err);
    }
  }
}
