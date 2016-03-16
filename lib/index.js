/**
 * @class traceview
 */

// Graceful failure
let bindings
let enabled = false
try {
  bindings = require('traceview-bindings')
  enabled = true
} catch (e) {
  console.warn("Could not find liboboe native bindings\n\n" + e.stack)
}

exports.addon = bindings

//
// Load dependencies
//
const debug = require('debug')
const log = debug('traceview:settings')
const error = debug('traceview:error')
const cls = require('continuation-local-storage')
const extend = require('util')._extend
const shimmer = require('shimmer')
const crypto = require('crypto')
const path = require('path')
const os = require('os')
const fs = require('fs')


// Eagerly create variables to store classes.
// ES6 does not hoist let statements.
let Event
let Layer
let Profile

//
// Create a reporter
//
let reporter
try {
  reporter = exports.reporter = new bindings.UdpReporter()
} catch (e) {
  reporter = exports.reporter = {}
  log('Reporter unable to connect')
}


//
// Abstract settings with setters and getters
//
let traceMode, sampleRate, sampleSource, host, port, accessKey

/**
 * Set accessKey, which also sets rumId
 *
 * @property accessKey
 * @type String
 */
Object.defineProperty(exports, 'accessKey', {
  get() { return accessKey },
  set(value) {
    accessKey = value

    // Generate base64-encoded SHA1 hash of accessKey
    exports.rumId = crypto.createHash('sha1')
      .update('RUM' + value)
      .digest('base64')
      .replace(/\+/g,'-')
      .replace(/\//g,'_')
  }
})

// Helper to map strings to addon keys
let modeMap = {
  through: bindings ? bindings.TRACE_THROUGH : 2,
  always: bindings ? bindings.TRACE_ALWAYS : 1,
  never: bindings ? bindings.TRACE_NEVER : 0
}

/**
 * Tracing mode
 *
 * @property traceMode
 * @type String
 * @default 'through'
 */
Object.defineProperty(exports, 'traceMode', {
  get() { return traceMode },
  set(value) {
    if (typeof value !== 'number') {
      value = modeMap[value]
    }
    log('set tracing mode to ' + value)
    if (enabled) {
      bindings.Context.setTracingMode(value)
    }
    traceMode = value
  }
})

/**
 * Sample rate
 *
 * @property sampleRate
 * @type Number
 */
Object.defineProperty(exports, 'sampleRate', {
  get() { return sampleRate },
  set(value) {
    log('set sample rate to ' + value)
    if (enabled) {
      bindings.Context.setDefaultSampleRate(value)
    }
    sampleRate = value
  }
})

/*!
 * Sample source
 *
 * @property sampleSource
 * @type Number
 */
Object.defineProperty(exports, 'sampleSource', {
  get() { return sampleSource },
  set(value) {
    sampleSource = value
  }
})

/**
 * Reporter host
 *
 * @property host
 * @type String
 */
Object.defineProperty(exports, 'host', {
  get() { return reporter.host },
  set(value) {
    if (value !== host) {
      try {
        reporter.host = value
      } catch (e) {
        log('Reporter unable to connect')
      }
    }
  }
})

/**
 * Reporter port
 *
 * @property port
 * @type Number | String
 */
Object.defineProperty(exports, 'port', {
  get() { return reporter.port },
  set(value) {
    if (value !== port) {
      try {
        reporter.port = value
      } catch (e) {
        log('Reporter unable to connect')
      }
    }
  }
})

/**
 * Log settings
 *
 * @property log
 * @type String
 */
let logLevel
Object.defineProperty(exports, 'log', {
  get() { return logLevel },
  set(value) {
    if (value !== logLevel) {
      logLevel = value

      if (typeof value === 'string') {
        value = value.split(',')
      }
      if (Array.isArray(value)) {
        let keys = value.map(pattern => 'traceview:' + pattern).join(',')
        let flag = process.env.DEBUG
        if (flag) keys = flag + ',' + keys
        debug.enable(keys)
      }
    }
  }
})

// Sugar to detect if the current mode is of a particular type
Object.keys(modeMap).forEach(mode => {
  Object.defineProperty(exports, mode, {
    get() { return traceMode === modeMap[mode] }
  })
})


//
// Load config file, if present
//
let config
try {
  config = require(process.cwd() + '/traceview')
  extend(exports, config)
} catch (e) {
  config = {}
}

// Mix module-specific configs onto the object
const moduleConfigs = require('./defaults')
Object.keys(moduleConfigs).forEach(mod => {
  exports[mod] = moduleConfigs[mod]
  extend(exports[mod], config[mod] || {})
})

//
// Disable module when conflicts are found
//
if ( ! exports.ignoreConflicts) {
  let modules = Object.keys(require.cache)
  let possibleConflicts = [
    'newrelic',
    'strong-agent',
    'appdynamics'
  ]
  function checkMod (conflict, mod) {
    return (new RegExp(`/node_modules/${conflict}/`)).test(mod)
  }
  let conflicts = possibleConflicts.filter(conflict => {
    return modules.filter(mod => checkMod(conflict, mod)).length > 0
  })

  function andList (list) {
    let last = list.pop()
    return (list.length ? list.join(', ') + ', and ' : '') + last
  }

  if (conflicts.length > 0) {
    enabled = false
    console.log([
      `Users have reported that the following modules conflict`,
      `with TraceView instrumentation: ${andList(conflicts)}.`,
      `Please uninstall them and restart the application.`
    ].join(` `))
  }
}

//
// If accessKey was not defined in the config file, attempt to locate it
//
if ( ! accessKey) {
  let cuuid = process.env.TRACEVIEW_CUUID
  if (cuuid) {
    exports.accessKey = cuuid
  } else {
    // Attempt to find access_key in tracelyzer configs
    let configFile = '/etc/tracelytics.conf'
    if (fs.existsSync(configFile)) {
      let contents = fs.readFileSync(configFile)
      let lines = contents.toString().split('\n')

      // Check each line until we find a match
      let line
      while ((line = lines.shift())) {
        if (/^tracelyzer.access_key=/.test(line) || /^access_key/.test(line)) {
          let parts = line.split('=')
          exports.accessKey = parts[1].trim()
          break
        }
      }
    }
  }
}

//
// Use continuation-local-storage to follow traces through a request
//
let storeName = 'tv-request-store'
Object.defineProperty(exports, 'requestStore', {
  get() {
    return cls.getNamespace(storeName) || cls.createNamespace(storeName)
  }
})

/**
 * Whether or not the current code path is being traced
 *
 * @property tracing
 * @type Boolean
 * @readOnly
 */
Object.defineProperty(exports, 'tracing', {
  get() { return !!Event.last }
})

/**
 * Bind a function, if tracing
 *
 * @method bind
 * @param {Function} fn The function to bind to the trace context
 * @return {Function} The possibly bound function
 */
exports.bind = function (fn) {
  try {
    return exports.tracing && typeof fn === 'function'
      ? exports.requestStore.bind(fn)
      : fn
  } catch (e) {
    error('failed to bind callback', e.stack)
  }
}

/**
 * Bind an emitter, if tracing
 *
 * @method bindEmitter
 * @param {EventEmitter} em The emitter to bind to the trace context
 * @return {EventEmitter} The possibly bound emitter
 */
exports.bindEmitter = function (em) {
  try {
    return exports.tracing && em && typeof em.on === 'function'
      ? exports.requestStore.bindEmitter(em)
      : em
  } catch (e) {
    error('failed to bind emitter', e.stack)
  }
}

/**
 * Generate a backtrace string
 *
 * @method backtrace
 */
exports.backtrace = function ()  {
  var e = new Error('backtrace')
  return e.stack.replace(/^.*\n\s*/, '').replace(/\n\s*/g, '\n')
}

//
// The remaining things require bindings to be present.
// TODO: Make Layer, Profile and Event exportable without liboboe
//
if ( ! enabled) {
  exports.reportError = noop
  exports.reportInfo = noop
  exports.sample = function () { return false }
  exports.instrument = function (build, run, options, callback) {
    if (typeof options === 'function') {
      callback = options
    }
    run(callback)
  }
} else {
  /*!
   * Determine if the request should be sampled
   *
   * @method sample
   * @param {String} layer  Layer name
   * @param {String} xtrace x-trace header to continuing from, or null
   * @param {String} meta   x-tv-meta header, if available
   */
  exports.sample = function (layer, xtrace, meta) {
    var rv = bindings.Context.sampleRequest(layer, xtrace || '', meta || '')
    if ( ! rv[0] && exports.skipSample) return [1,1,1]
    if ( ! rv[0]) return false
    exports.sampleSource = rv[1]
    exports.sampleRate = rv[2]
    return rv
  }


  /**
   * Apply custom instrumentation to a function.
   *
   * The `builder` function is run only when tracing, and is used to generate
   * a layer. It can include custom data, but it can not be nested and all
   * values must be strings or numbers.
   *
   * The `runner` function runs the function which you wish to instrument.
   * Rather than giving it a callback directly, you give the done argument.
   * This tells traceview when your instrumented code is done running.
   *
   * The `callback` function is simply the callback you normally would have
   * given directly to the code you want to instrument. It receives the same
   * arguments as were received by the `done` callback for the `runner`
   * function, and the same `this` context is also applied to it.
   *
   *     function builder (last) {
   *       return last.descend('custom', { Foo: 'bar' })
   *     }
   *
   *     function runner (done) {
   *       fs.readFile('some-file', done)
   *     }
   *
   *     function callback (err, data) {
   *       console.log('file contents are: ' + data)
   *     }
   *
   *     tv.instrument(builder, runner, callback)
   *
   * @method instrument
   * @param {String} build                        Layer name or builder function
   * @param {String} run                          Code to instrument and run
   * @param {Object} [options]                    Options
   * @param {Object} [options.enabled]            Enable tracing, on by default
   * @param {Object} [options.collectBacktraces]  Enable tracing, on by default
   * @param {Object} callback                     Callback
   */
  exports.instrument = function (build, run, options, callback) {
    // Normalize dynamic arguments
    try {
      if (typeof options !== 'object') {
        callback = options
        options = { enabled: true }
      }

      if ( ! callback && run.length) {
        callback = noop
      }
    } catch (e) {
      error('tv.instrument failed to normalize arguments', e.stack)
    }

    // If not tracing, skip
    let last = Layer.last
    if ( ! last) {
      return run(callback)
    }

    // If not enabled, skip
    if ( ! options.enabled) {
      return run(exports.bind(callback))
    }

    var layer
    try {
      // Build layer
      layer = typeof build === 'function' ? build(last) : last.descend(build)

      // Attach backtrace, if enabled
      if (options.collectBacktraces) {
        layer.events.entry.Backtrace = exports.backtrace(4)
      }
    } catch (e) {
      error('tv.instrument failed to run builder', e.stack)
    }

    // Detect if sync or async, and run layer appropriately
    return callback
      ? layer.runAsync(makeWrappedRunner(run, callback))
      : layer.runSync(run)
  }

  // This makes a callback-wrapping layer runner
  function makeWrappedRunner (run, callback) {
    return wrap => run(wrap(callback))
  }

  function noop () {}


  /**
   * Report an error event in the current trace.
   *
   * @method reportError
   * @param {Error} error The error instance to report
   */
  exports.reportError = function (error) {
    let last = Layer.last
    if (last) last.error(error)
  }


  /**
   * Report an info event in the current trace.
   *
   * @method reportInfo
   * @param {Object} data Data to report in the info event
   */
  exports.reportInfo = function (data) {
    let last = Layer.last
    if (last) last.info(data)
  }


  //
  // Expose lower-level components
  //
  Layer = require('./layer')
  Event = require('./event')
  Profile = require('./profile')
  exports.Profile = Profile
  exports.Layer = Layer
  exports.Event = Event


  //
  // Send __Init event
  //
  process.nextTick(function () {
    exports.requestStore.run(function () {
      let data = {
        '__Init': 1,
        'Layer': 'nodejs',
        'Label': 'entry',
        'Node.Version': process.versions.node,
        'Node.V8.Version': process.versions.v8,
        'Node.LibUV.Version': process.versions.uv,
        'Node.OpenSSL.Version': process.versions.openssl,
        'Node.Ares.Version': process.versions.ares,
        'Node.ZLib.Version': process.versions.zlib,
        'Node.HTTPParser.Version': process.versions.http_parser,
        'Node.Oboe.Version': require('../package.json').version,
      }

      let base = path.join(process.cwd(), 'node_modules')
      let modules
      try { modules = fs.readdirSync(base) }
      catch (e) {}

      if (Array.isArray(modules)) {
        modules.forEach(mod => {
          if (mod === '.bin' || mod[0] === '@') return
          try {
            const pkg = require(`${base}/${mod}/package.json`)
            data[`Node.Module.${pkg.name}.Version`] = pkg.version
          } catch (e) {}
        })
      }

      let layer = new Layer('nodejs', null, data)
      layer.enter()
      layer.exit()
    })
  })


  //
  // Enable require monkey-patcher
  //
  const patcher = require('./require-patch')
  patcher.enable()
}
