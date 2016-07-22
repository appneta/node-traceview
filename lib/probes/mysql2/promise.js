'use strict'

const requirePatch = require('../../require-patch')

module.exports = function (mysql2) {
  // NOTE: This force loads the instrumentation for the non-promise interface
  requirePatch.relativeRequire('mysql2')
  return mysql2
}
