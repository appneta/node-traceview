exports.run = function (ctx, done) {
  var conf = ctx.tv['cassandra-driver']
  conf.sanitizeSql = true
  ctx.cassandra.execute("SELECT * from foo where bar='1'", function (err) {
    conf.sanitizeSql = false
    done(err)
  })
}
