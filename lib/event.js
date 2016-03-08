var logSend = require('debug')('traceview:event:send')
var logEnter = require('debug')('traceview:event:enter')
var logChange = require('debug')('traceview:event:change')
var logEdge = require('debug')('traceview:event:edge')
var logError = require('debug')('traceview:event:error')
var logSet = require('debug')('traceview:event:set')

var extend = require('util')._extend
var tv = require('./')
var addon = tv.addon

// Export the event class
module.exports = Event

function startTrace () {
  return addon.Context.startTrace()
}

// Create an event from a specific context,
// without global-state side effects.
// We have to create events at weird times,
// so we need to manage linking manually.
function continueTrace (parent) {
  // Store the current context
  var ctx = addon.Context.toString()

  // Temporarily modify the context
  if (parent.event) {
    parent = parent.event
  }
  addon.Context.set(parent)

  // Create an event in the mofieied context
  var e = addon.Context.createEvent()

  // Restore the original context
  addon.Context.set(ctx)
  return e
}

/**
 * Creates an event
 *
 * @class Event
 * @constructor
 * @param {String} name Event name
 * @param {String} label Event label (usually entry or exit)
 * @param {Object} parent Parent event to edge back to
 */
function Event (layer, label, parent) {
  Object.defineProperty(this, 'event', {
    value: parent ? continueTrace(parent) : startTrace()
  })

  if (parent) {
    parent = parent.event ? parent.event : parent
    Object.defineProperty(this, 'parent', {
      value: parent
    })
    logEdge(this.event + ' added edge ' + parent)
  }

  Object.defineProperty(this, 'edges', {
    value: []
  })

  this.Layer = layer
  this.Label = label
}

/**
 * Set this property to an error instance if an error occurs in the event
 *
 * @property error
 * @type {Error}
 */
Object.defineProperty(Event.prototype, 'error', {
  set: function (err) {
    logSet(this + ' setting error')

    // Allow string errors
    if (typeof err === 'string') {
      err = new Error(err)
    }

    if ( ! (err instanceof Error)) {
      logSet(this + ' tried to set error with non-error, non-string type')
      return
    }

    this.ErrorClass = err.constructor.name
    this.ErrorMsg = err.message
    this.Backtrace = err.stack
    logSet(this + ' set error to "' + this.ErrorMsg + '"')
  }
})

/**
 * Get taskId from native event string
 *
 * @property taskId
 * @type {String}
 * @readOnly
 */
Object.defineProperty(Event.prototype, 'taskId', {
  get: function () {
    return this.event.toString().substr(2, 40)
  }
})

/**
 * Get opId from native event string
 *
 * @property opId
 * @type {String}
 * @readOnly
 */
Object.defineProperty(Event.prototype, 'opId', {
  get: function () {
    return this.event.toString().substr(42)
  }
})

/**
 * Find the last reported event in the active context
 *
 * @property last
 * @type {Event}
 */
Object.defineProperty(Event, 'last', {
  get: function () {
    var last
    try {
      last = tv.requestStore.get('lastEvent')
    } catch (e) {
      logError('Can not access continuation-local-storage. Context may be lost.')
    }
    return last
  },
  set: function (value) {
    try {
      tv.requestStore.set('lastEvent', value)
    } catch (e) {
      logError('Can not access continuation-local-storage. Context may be lost.')
    }
  }
})

/**
 * Set pairs on this event
 * TODO: Use an internal pairs object to prevent hidden classes?
 * (https://developers.google.com/v8/design#fast-property-access)
 *
 * @method set
 * @param {Object} data Key/Value pairs of info to add to event
 */
Event.prototype.set = function (data) {
  extend(this, data || {})
}

/**
 * Enter the context of this event
 *
 * @method enter
 */
Event.prototype.enter = function () {
  logEnter(this + ' entered')
  addon.Context.set(this.event)
}

/**
 * Get the X-Trace ID string of the event
 *
 * @method toString
 */
Event.prototype.toString = function () {
  return this.event.toString()
}

/**
 * Send this event to the reporter
 *
 * @method send
 */
Event.prototype.send = function (data) {
  if (this.sent) return

  // Set data, if supplied
  if (typeof data === 'object') {
    this.set(data)
  }

  // We need to find and restore the context on
  // the JS side before using Reporter.sendReport()
  if (this.parent) {
    logEnter('restoring request context to ' + this.parent)
    addon.Context.set(this.parent)
  }

  // Do not continue from ignored events
  if ( ! this.ignore) {
    logEnter(this + ' set as last event')
    Event.last = this
  }

  // Mix data from the context object into the event
  var keys = Object.keys(this)
  var event = this.event
  var len = keys.length
  var key
  var i

  for (i = 0; i < len; i++) {
    key = keys[i]
    var val = this[key]
    try {
      event.addInfo(key, val)
      logChange(this + ' set ' + key + ' = ' + val)
    } catch (e) {
      logError(this + ' failed to set ' + key + ' = ' + val)
    }
  }

  // Mix edges from context object into the event
  var edges = this.edges
  len = edges.length

  for (i = 0; i < len; i++) {
    var edge = edges[i]
    if ( ! edge) {
      logError(this + ' tried to add empty edge')
      continue
    }

    if (edge.event) {
      edge = edge.event
    }

    try {
      event.addEdge(edge)
      logEdge(this + ' added edge ' + edge)
    } catch (e) {
      logError(this + ' failed to add edge ' + edge)
    }
  }

  // Send the event
  if ( ! tv.reporter.sendReport(event)) {
    logError(this + ' failed to send to reporter')
  } else {
    logSend(this + ' sent to reporter')
  }

  // Mark as sent to prevent double-sending
  Object.defineProperty(this, 'sent', {
    value: true
  })
}
