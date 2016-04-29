var requirePatch = require('../require-patch')
var shimmer = require('shimmer')
var slice = require('sliced')
var util = require('../util')
var URL = require('url')
var tv = require('..')
var Layer = tv.Layer
var conf = tv.amqplib

module.exports = function (amqplib, callbacks) {
  return patchConnection(amqplib, callbacks)
}

function patchConnection (v, callbacks) {
  if (v._tv_patched) return v
  v._tv_patched = true

  if (typeof v.connect !== 'function') return v

  shimmer.wrap(v, 'connect', function (fn) {
    return callbacks
      ? function connect (path, opts, cb) {
        var args = slice(arguments)
        var cb = args.pop()
        var withUrl = addUrl(path)
        return fn.apply(this, args.concat(function (err, conn) {
          err ? cb(err) : cb(null, withUrl(patchCallbackModel(conn)))
        }))
      }
      : function connect (a, b) {
        return fn.call(this, a, b)
          .then(addUrl(a))
          .then(patchChannelModel)
      }
  })

  return v
}

function addUrl (url) {
  url = typeof url == 'object' ? url : URL.parse(url)
  return function (v) {
    v.connection._tv_connection_data = url
    return v
  }
}

function patchChannelModel (v) {
  var proto = v.constructor.prototype
  if (proto._tv_patched) return v
  proto._tv_patched = true

  if (typeof proto.createChannel !== 'function') return v

  shimmer.wrap(proto, 'createChannel', function (fn) {
    return function createChannel () {
      return fn.call(this).then(patchChannel)
    }
  })

  return v
}

function patchCallbackModel (v) {
  var proto = v.constructor.prototype
  if (proto._tv_patched) return v
  proto._tv_patched = true

  if (typeof proto.createChannel !== 'function') return v

  shimmer.wrap(proto, 'createChannel', function (fn) {
    return function createChannel (cb) {
      return fn.call(this, function (err, ch) {
        err ? cb(err) : cb(null, patchChannel(ch))
      })
    }
  })

  return v
}

function patchChannel (v) {
  var proto = v.constructor.prototype
  if (proto._tv_patched) return v
  proto._tv_patched = true

  patchSendToQueue(v)
  patchConsume(v)

  return v
}

function patchSendToQueue (v) {
  var proto = v.constructor.prototype
  if (typeof proto.sendToQueue !== 'function') return v

  shimmer.wrap(proto, 'sendToQueue', function (fn) {
    return function (queue) {
      var args = slice(arguments)
      var self = this

      return tv.instrument(function (last) {
        var connOptions = self.connection._tv_connection_data
        var layer = last.descend('amqp', {
          Spec: 'pushq',
          Flavor: 'amqp',
          RemoteHost: connOptions.hostname + ':' + connOptions.port,
          Queue: queue,
          ExchangeAction: 'publish'
        })

        // Ensure there is an options object to add headers to
        var opts = args[3] || {}
        if (!~args.indexOf(opts)) {
          args.push(opts)
        }

        // Ensure headers contain SourceTrace
        opts.headers = opts.headers || {}
        opts.headers.SourceTrace = layer.events.entry.toString()

        return layer
      }, function () {
        return fn.apply(self, args)
      }, conf)
    }
  })

  return v
}

function patchConsume (v) {
  var proto = v.constructor.prototype
  if (typeof proto.consume !== 'function') return v

  shimmer.wrap(proto, 'consume', function (fn) {
    return function (queue, cb, options) {
      var channel = this

      return fn.call(this, queue, function (msg) {
        var args = slice(arguments)
        var self = this

        var xid = msg.properties.headers.SourceTrace

        return tv.startOrContinueTrace(xid, function (last) {
          var connOptions = channel.connection._tv_connection_data
          return last.descend('amqp', {
            Spec: 'job',
            Flavor: 'amqp',
            JobName: util.fnName(cb),
            RemoteHost: connOptions.hostname + ':' + connOptions.port,
            MsgID: msg.fields.consumerTag,
            RoutingKey: msg.fields.routingKey
          })
        }, function () {
          return cb.call(self, msg)
        }, conf)
      }, options)
    }
  })

  return v
}

function noop () {}
