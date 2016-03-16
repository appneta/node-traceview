const debug = require('debug')('traceview:require-patch')
const Module = require('module')
const WeakMap = require('es6-weak-map')
const fs = require('fs')

const realRequire = module.__proto__.require
const patched = new WeakMap()
const probes = {}

let exports = module.exports = {
  //
  // Set locations of instrumentation wrappers to patch named modules
  //
  register(name, path) {
    probes[name] = path
  },
  deregister(name) {
    delete probes[name]
  },

  //
  // Patch require function to monkey patch probes onto modules at load-time
  //
  enable() {
    module.__proto__.require = patchedRequire
  },
  disable() {
    module.__proto__.require = realRequire
  }
}

function patchedRequire (name) {
  var module = realRequire.call(this, name)

  // Only apply probes on first run
  if (module && probes.hasOwnProperty(name) && ! patched.get(module)) {
    // Set relative require helper to point to the module being patched
    exports.relativeRequire = this.require.bind(this)

    // Patch
    var path = Module._resolveFilename(name, this)
    module = realRequire(probes[name])(module)

    // Mark as patched
    patched.set(module, true)

    // Replace cached version
    if (require.cache[path]) {
      require.cache[path].exports = module
    }

    debug(`patched ${name}`)
  }

  return module
}


//
// Build a list of all modules we have probes for
//
fs.readdirSync(__dirname + '/probes').forEach(function (file) {
  var m = file.match(/^(.*)+\.js$/)
  if (m && m.length == 2) {
    var name = m[1]
    exports.register(name, __dirname + '/probes/' + name)
    debug('found ' + name + ' probe')
  }
})
