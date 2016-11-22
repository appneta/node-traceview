var helper = require('../helper')
var Address = helper.Address
var tv = helper.tv
var addon = tv.addon

var should = require('should')

var addr = Address.from(process.env.TEST_MYSQL || 'localhost:3306')[0]
var user = process.env.TEST_MYSQL_USERNAME || process.env.DATABASE_MYSQL_USERNAME || 'root'
var pass = process.env.TEST_MYSQL_PASSWORD || process.env.DATABASE_MYSQL_PASSWORD || ''
var soon = global.setImmediate || process.nextTick

var checks = {
  entry: function (msg) {
    msg.should.have.property('Layer', 'mysql')
    msg.should.have.property('Label', 'entry')
    msg.should.have.property('Database', 'test')
    msg.should.have.property('Flavor', 'mysql')
    msg.should.have.property('RemoteHost', addr.toString())
  },
  error: function (msg) {
    msg.should.have.property('Label', 'error')
  },
  exit: function (msg) {
    msg.should.have.property('Layer', 'mysql')
    msg.should.have.property('Label', 'exit')
  }
}

//
// Intercept tracelyzer messages for analysis
//
function makeEmitter () {
  var emitter = {}

  before(function (done) {
    emitter.server = helper.tracelyzer(done)
    tv.sampleRate = tv.addon.MAX_SAMPLE_RATE
    tv.traceMode = 'always'
    tv.fs.enabled = false
  })
  after(function (done) {
    tv.fs.enabled = true
    emitter.server.close(done)
  })

  return emitter
}

describe('probes/mysql2', function () {
  var mysql = require('mysql2')
  var emitter = makeEmitter()
  this.timeout(10000)
  var ctx = {}
  var cluster
  var pool
  var db

  function makeDb (conf, done) {
    var db = mysql.createConnection(conf)
    db.connect(done)
    return db
  }

  // Ensure database/table existence
  before(function (done) {
    var db = makeDb({
      host: addr.host,
      port: addr.port,
      user: user,
      password: pass
    }, function (err) {
      if (err) return done(err)
      db.query('CREATE DATABASE IF NOT EXISTS test;', function (err) {
        if (err) return done(err)
        db.end(done)
      })
    })
  })

  // Make connection
  before(function (done) {
    db = ctx.mysql = makeDb({
      host: addr.host,
      port: addr.port,
      database: 'test',
      user: user,
      password: pass
    }, function (err) {
      if (err) return done(err)
      db.query('CREATE TABLE IF NOT EXISTS test (foo varchar(255));', done)
    })

    // Set pool and pool cluster
    var poolConfig = {
      connectionLimit: 10,
      host: addr.host,
      port: addr.port,
      database: 'test',
      user: user,
      password: pass
    }

    pool = db.pool = mysql.createPool(poolConfig)
    cluster = db.cluster = mysql.createPoolCluster()
    cluster.add(poolConfig)
  })

  after(function (done) {
    cluster.end()
    pool.end()
    db.end(done)
  })

  it('should trace a basic query', test_basic)
  it('should trace a query with a value list', test_values)
  it('should trace a query with a value object', test_object)
  it('should trace a streaming query', test_stream)
  it('should trace a pooled query', test_pool)
  it('should trace a cluster pooled query', test_clustered_pool)
  it('should sanitize a query', test_sanitize)
  it('should trim long queries', test_long_query)
  it('should skip when disabled', test_disabled)

  function test_basic (done) {
    helper.test(emitter.server, helper.run(ctx, 'mysql/basic'), [
      function (msg) {
        checks.entry(msg)
        msg.should.have.property('Query', 'SELECT 1')
      },
      function (msg) {
        checks.exit(msg)
      }
    ], done)
  }

  function test_values (done) {
    helper.test(emitter.server, helper.run(ctx, 'mysql/values'), [
      function (msg) {
        checks.entry(msg)
        msg.should.have.property('Query', 'SELECT ?')
        msg.should.have.property('QueryArgs', '["1"]')
      },
      function (msg) {
        checks.exit(msg)
      }
    ], done)
  }

  function test_object (done) {
    helper.test(emitter.server, helper.run(ctx, 'mysql/object'), [
      function (msg) {
        checks.entry(msg)
        msg.should.have.property('Query', 'INSERT INTO test SET ?')
        msg.should.have.property('QueryArgs', '{"foo":"bar"}')
      },
      function (msg) {
        checks.exit(msg)
      }
    ], done)
  }

  function test_stream (done) {
    helper.test(emitter.server, helper.run(ctx, 'mysql/stream'), [
      function (msg) {
        checks.entry(msg)
        msg.should.have.property('Query', 'SELECT 1')
      },
      function (msg) {
        checks.exit(msg)
      }
    ], done)
  }

  function test_pool (done) {
    helper.test(emitter.server, helper.run(ctx, 'mysql/pool'), [
      function (msg) {
        checks.entry(msg)
        msg.should.have.property('Query', 'SELECT 1')
      },
      function (msg) {
        checks.exit(msg)
      }
    ], done)
  }

  function test_clustered_pool (done) {
    helper.test(emitter.server, helper.run(ctx, 'mysql/pool-cluster'), [
      function (msg) {
        checks.entry(msg)
        msg.should.have.property('Query', 'SELECT 1')
      },
      function (msg) {
        checks.exit(msg)
      }
    ], done)
  }

  function test_sanitize (done) {
    helper.test(emitter.server, helper.run(ctx, 'mysql/sanitize'), [
      function (msg) {
        checks.entry(msg)
        msg.should.have.property('Query', 'SELECT * FROM test WHERE "foo" = \'?\'')
      },
      function (msg) {
        checks.exit(msg)
      }
    ], done)
  }

  function test_long_query (done) {
    helper.test(emitter.server, function (done) {
      var query = 'SELECT '
      for (var i = 0; i < 3000; i++) {
        query += '1'
      }
    	ctx.mysql.query(query, done)
    }, [
      function (msg) {
        checks.entry(msg)
        msg.should.have.property('Query')
        msg.Query.length.should.not.be.above(2048)
      },
      function (msg) {
        checks.exit(msg)
      }
    ], function (err) {
      done(err)
    })
  }

  function test_disabled (done) {
    tv.mysql.enabled = false
    helper.test(emitter.server, helper.run(ctx, 'mysql/basic'), [], function (err) {
      tv.mysql.enabled = true
      done(err)
    })
  }

})

describe('probes/mysql2/promise', function () {
  var mysql = require('mysql2/promise')
  var Promise = require('bluebird')
  var emitter = makeEmitter()
  this.timeout(10000)
  var pool
  var db

  function makeDb (conf) {
    return mysql.createConnection(conf)
  }

  // Ensure database/table existence
  before(function () {
    return makeDb({
      Promise: Promise,
      host: addr.host,
      port: addr.port,
      user: user,
      password: pass,
    }).then(function (db) {
      return db.query('CREATE DATABASE IF NOT EXISTS test;')
        .then(function () { return db.end() })
    })
  })

  // Make connection
  before(function () {
    return makeDb({
      Promise: Promise,
      host: addr.host,
      port: addr.port,
      database: 'test',
      user: user,
      password: pass
    }).then(function (_db) {
      db = _db
      return db
    }).then(function (db) {
      return db.query('CREATE TABLE IF NOT EXISTS test (foo varchar(255));')
    }).then(function () {
      pool = mysql.createPool({
        Promise: Promise,
        connectionLimit: 10,
        host: addr.host,
        port: addr.port,
        database: 'test',
        user: user,
        password: pass
      })
    })
  })

  after(function () {
    return pool.end().then(function () {
      return db.end()
    })
  })

  it('should trace a basic query', function (done) {
    helper.test(emitter.server, function (done) {
      handle(db.query('SELECT 1'), done)
    }, [
      function (msg) {
        checks.entry(msg)
        msg.should.have.property('Query', 'SELECT 1')
      },
      function (msg) {
        checks.exit(msg)
      }
    ], done)
  })

  it('should trace a pool query', function (done) {
    helper.test(emitter.server, function (done) {
      handle(pool.query('SELECT 1'), done)
    }, [
      function (msg) {
        checks.entry(msg)
        msg.should.have.property('Query', 'SELECT 1')
      },
      function (msg) {
        checks.exit(msg)
      }
    ], done)
  })

  function handle (p, done) {
    p.then(function (v) { done(null, v) }).catch(done)
  }

})
