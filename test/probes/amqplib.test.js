var helper = require('../helper')
var tv = helper.tv
var addon = tv.addon

var Promise = require('bluebird')
var should = require('should')
var db_host = process.env.TEST_RABBITMQ_3_5 || 'localhost:5672'

describe('probes.amqplib', function () {
  var emitter
  var ctx = {}
  var client
  var db

  //
  // Define some general message checks
  //
  var checks = {
    entry: function (msg) {
      msg.should.have.property('Layer', 'amqp')
      msg.should.have.property('Label', 'entry')
      msg.should.have.property('Flavor', 'amqp')
      msg.should.have.property('RemoteHost', db_host)
    },
    exit: function (msg) {
      msg.should.have.property('Layer', 'amqp')
      msg.should.have.property('Label', 'exit')
    },
    pushq: function (msg) {
      msg.should.have.property('Spec', 'pushq')
      msg.should.have.property('ExchangeAction', 'publish')
    },
    job: function (msg) {
      msg.should.have.property('Spec', 'job')
      msg.should.have.property('MsgID').and.be.an.instanceOf(String)
      msg.should.have.property('JobName').and.be.an.instanceOf(String)
    }
  }

  //
  // Intercept tracelyzer messages for analysis
  //
  before(function (done) {
    emitter = helper.tracelyzer(done)
    tv.sampleRate = tv.addon.MAX_SAMPLE_RATE
    tv.traceMode = 'always'
  })
  after(function (done) {
    emitter.close(done)
  })

  function makeTests (context) {
    var queue = 'tasks-' + Math.random()

    it('should report send and consume in existing trace', function (done) {
      helper.test(emitter, function (done) {
        context.channel.assertQueue(queue)
        context.channel.sendToQueue(queue, new Buffer('promises'))
        context.channel.consume(queue, function (msg) {
          context.channel.ack(msg)
          setImmediate(done)
        })
      }, [
        function (msg) {
          checks.entry(msg)
          checks.pushq(msg)
        },
        function (msg) {
          checks.exit(msg)
        },
        function (msg) {
          checks.entry(msg)
          checks.job(msg)
          msg.should.have.property('RoutingKey', queue)
        },
        function (msg) {
          checks.exit(msg)
        }
      ], done)
    })

    it('should start new trace for consume', function (done) {
      context.channel.assertQueue(queue)
      context.channel.sendToQueue(queue, new Buffer('promises'))
      context.channel.consume(queue, function (msg) {
        context.channel.ack(msg)
        done()
      })

      helper.doChecks(emitter, [
        function (msg) {
          checks.entry(msg)
          checks.job(msg)
          msg.should.have.property('RoutingKey', queue)
        },
        function (msg) {
          checks.exit(msg)
        }
      ], done)
    })
  }

  describe('promises', function () {
    var amqp = require('amqplib')
    var context = {}
    var client

    before(function () {
      return amqp.connect('amqp://' + db_host)
        .then(function (conn) {
          client = conn
          return client.createChannel()
        })
        .then(function (ch) {
          context.channel = ch
        })
    })

    after(function (done) {
      context.channel.close()
      context.channel.on('close', done)
    })

    after(function (done) {
      client.close()
      client.on('close', done)
    })

    makeTests(context)
  })

  describe('callbacks', function () {
    var amqp = require('amqplib/callback_api')
    var context = {}
    var client

    before(function (done) {
      amqp.connect('amqp://' + db_host, function (err, conn) {
        if (err) return done(err)
        client = conn
        client.createChannel(function (err, ch) {
          if (err) return done(err)
          context.channel = ch
          done()
        })
      })
    })

    after(function (done) {
      context.channel.close()
      context.channel.on('close', done)
    })

    after(function (done) {
      client.close()
      client.on('close', done)
    })

    makeTests(context)
  })

})
