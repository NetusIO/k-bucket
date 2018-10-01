'use strict'

var crypto = require('crypto')
var KBucket = require('..')

var seed = process.env.SEED || crypto.randomBytes(32).toString('hex')
console.log('Seed: ' + seed)

var ids = []
var bucket = new KBucket()
for (var j = 0; j < 1e4; j++) {
  var id = crypto.createHash('sha256').update(seed).digest()
  bucket.add({ id: id })
  ids.push(id)
}

console.time('KBucket.closest')
for (var i = 0; i < 1e5; i++) {
  bucket.closest(ids[i % ids.length], 10)
}
console.timeEnd('KBucket.closest')
console.log('Memory: ', process.memoryUsage())
