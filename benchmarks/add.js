'use strict'

var crypto = require('crypto')
var KBucket = require('../')

var contacts = []
var seed = process.env.SEED || crypto.randomBytes(32).toString('hex')
console.log('make digests from seed: ' + seed)
for (var i = 0; i < 20; ++i) {
  seed = crypto.createHash('sha256').update(seed).digest()
  contacts[i] = { id: seed }

}

function add (kb, contacts) {
  for (var i = 0; i < 20; ++i) {
    var id = contacts[i]
    for (var j = 0; j < 1e5; ++j) kb.add(id)
  }
}
console.time('KBucket.add')
add(new KBucket(), contacts)
console.timeEnd('KBucket.add')

console.log('Memory: ', process.memoryUsage())
