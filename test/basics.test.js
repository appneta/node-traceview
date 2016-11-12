var helper = require('./helper')
var should = require('should')
var debug = require('debug')
var http = require('http')
var tv = require('..')
var Layer = tv.Layer

describe('basics', function () {
  it('should set trace mode', function () {
    tv.traceMode = tv.addon.TRACE_ALWAYS
  })

  it('should get trace mode', function () {
    tv.traceMode.should.equal(tv.addon.TRACE_ALWAYS)
  })

  it('should set trace mode as string', function () {
    tv.traceMode = 'never'
    tv.traceMode.should.equal(tv.addon.TRACE_NEVER)

    tv.traceMode = 'always'
    tv.traceMode.should.equal(tv.addon.TRACE_ALWAYS)

    tv.traceMode = 'through'
    tv.traceMode.should.equal(tv.addon.TRACE_THROUGH)
  })

  it('should set and get sample rate', function () {
    tv.sampleRate = 100
    tv.sampleRate.should.equal(100)
  })

  it('should have sugary trace mode detectors', function () {
    // Reset first
    tv.traceMode = tv.addon.TRACE_THROUGH

    tv.always.should.be.false
    tv.traceMode = tv.addon.TRACE_ALWAYS
    tv.always.should.be.true

    tv.never.should.be.false
    tv.traceMode = tv.addon.TRACE_NEVER
    tv.never.should.be.true

    tv.through.should.be.false
    tv.traceMode = tv.addon.TRACE_THROUGH
    tv.through.should.be.true
  })

  it('should get access key', function () {
    tv.accessKey.should.be.a.String
  })

  it('should set logging', function () {
    var called = false
    var real = debug.enable
    debug.enable = function () {
      called = true
      debug.enable = real
    }
    var before = tv.log
    tv.log = 'layer'
    tv.log.should.equal('layer')
    called.should.equal(true)
    tv.log = before
  })

  it('should be able to detect if it is in a trace', function () {
    tv.tracing.should.be.false
    var layer = new Layer('test')
    layer.run(function () {
      tv.tracing.should.be.true
    })
  })

  it('should support sampling', function () {
    var skipSample = tv.skipSample
    tv.skipSample = false
    tv.traceMode = 'always'
    tv.sampleRate = tv.addon.MAX_SAMPLE_RATE
    var s = tv.sample('test')
    s.should.not.be.false

    // TODO: Expose sample rate in bindings so this can be tested again
    // tv.sampleRate = 1
    // var samples = []
    // for (var i = 0; i < 10000; i++) {
    //   s = tv.sample('test')
    //   samples.push(!!s[0])
    // }
    // samples.should.containEql(false)
    tv.skipSample = skipSample
  })

  it('should passthrough sampling arguments to sampleRequest', function () {
    var called = false
    var layer = 'test'
    var xtrace = 'a'
    var meta = 'b'
    var url = 'c'

    var realSample = tv.addon.Context.sampleRequest
    tv.addon.Context.sampleRequest = function (a, b, c, d) {
      tv.addon.Context.sampleRequest = realSample
      called = true
      a.should.equal(layer)
      b.should.equal(xtrace)
      c.should.equal(meta)
      d.should.equal(url)
      return ''
    }

    var s = tv.sample(layer, xtrace, meta, url)
    called.should.equal(true)
  })

  it('should not call sampleRate setter from sample function', function () {
    tv.sampleRate = tv.addon.MAX_SAMPLE_RATE
    tv.traceMode = 'always'
    var skipSample = tv.skipSample
    tv.skipSample = false

    function after (err) {
      tv.addon.Context.setDefaultSampleRate = old
      tv.skipSample = skipSample
    }

    var old = tv.addon.Context.setDefaultSampleRate
    tv.addon.Context.setDefaultSampleRate = function () {
      after()
      throw new Error('Should not have called sampleRate setter')
    }

    tv.sample('test')
    after()
  })

  it('should not trace in through without xtrace header', function (done) {
    tv.sampleRate = tv.addon.MAX_SAMPLE_RATE
    tv.traceMode = 'through'

    var sendReport = tv.reporter.sendReport
    tv.reporter.sendReport = function (event) {
      tv.reporter.sendReport = sendReport
      done(new Error('Tried to send an event'))
    }

    var server = http.createServer(function (req, res) {
      res.end('hi')
    })

    server.listen(function () {
      var port = server.address().port
      http.get('http://localhost:' + port, function (res) {
        res.on('end', function () {
          tv.reporter.sendReport = sendReport
          done()
        })
        res.resume()
      })
    })
  })

  it('should include expected data in __Init event', function () {
    var data = tv.initData()
    data.should.have.property('__Init', 1)
    data.should.have.property('App')
    data.App.should.have.lengthOf(32)
    data.should.not.have.property('AApp')

    // Verify component versions
    data.should.have.property(
      'Node.Version',
      process.versions.node
    )
    data.should.have.property(
      'Node.V8.Version',
      process.versions.v8
    )
    data.should.have.property(
      'Node.LibUV.Version',
      process.versions.uv
    )
    data.should.have.property(
      'Node.OpenSSL.Version',
      process.versions.openssl
    )
    data.should.have.property(
      'Node.Ares.Version',
      process.versions.ares
    )
    data.should.have.property(
      'Node.ZLib.Version',
      process.versions.zlib
    )
    data.should.have.property(
      'Node.HTTPParser.Version',
      process.versions.http_parser
    )
    data.should.have.property(
      'Node.Oboe.Version',
      require('../package.json').version
    )

    // Validate module versions have been added
    data.should.have.property(
      'Node.Module.traceview-bindings.Version',
      require('traceview-bindings/package.json').version
    )

    // TODO: Figure out a way to allow setting appToken here
    // and unsetting after so I can test AApp presence here
    // without interfering with other tests.
  })
})
