'use strict'

const requirePatch = require('../require-patch')
const patch = require('./mysql')

module.exports = function (mysql2) {
  try {
    const Pool = requirePatch.relativeRequire('mysql2/lib/pool')
    const Connection = requirePatch.relativeRequire('mysql2/lib/connection')
    const Query = requirePatch.relativeRequire('mysql2/lib/commands/query')

    patch.patchPool(Pool.prototype)
    patch.patchConnection(Connection.prototype, Query)
  } catch (e) {}

  return mysql2
}
