// "MIT License"
//
// Copyright (c) Matthew Voss
//
// Permission is hereby granted, free of charge, to any person obtaining a copy
// of this software and associated documentation files (the "Software"), to deal
// in the Software without restriction, including without limitation the rights
// to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
// copies of the Software, and to permit persons to whom the Software is
// furnished to do so, subject to the following conditions:
//
// The above copyright notice and this permission notice shall be included in
// all copies or substantial portions of the Software.
//
// THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
// IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
// FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
// AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
// LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
// OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
// THE SOFTWARE.

var inherits = require('util').inherits
var EventEmitter = require('events')

//
// Kadamlia DHT k-bucket for storing peer information
//
// All ids referred to in this class are buffers or arrays of bytes (i.e. IP addresses).
//
// opt: {
//    distance:     override function that returns the XOR distance between two IDs
//    arbiter:      override function.  Given prev and new contact for an update, returns the one to be kept (stored)
//    root_id:      the local node id.  defaults to 0x800000...
//    metadata:     optional extra data to store with the bucket.  not touched by KBucket
//    bucket_len:   number of nodes that a k-bucket can contain before being full or split.
//    num_to_ping:  number of nodes to ping when a bucket that should not be split becomes full
// }
//
function KBucket (opt) {
  opt = opt || {}
  EventEmitter.call(this)

  this.root_id = opt.root_id || opt.localNodeId || default_id(20)
  this.bucket_len = opt.bucket_len || opt.numberOfNodesPerKBucket || 20
  this.num_to_ping = opt.num_to_ping || opt.numberOfNodesToPing || 3
  this.distance = opt.distance || distance
  // use an arbiter from options or vectorClock arbiter by default
  this.arbiter = opt.arbiter || function (prev, candidate) { return prev.vtime > candidate.vtime ? prev : candidate }
  this.metadata = opt.metadata || {}

  this.root_id.length < 33 || err('ids cannot exceed 32 bytes')
  this.root = new Node()
}

KBucket.prototype = {
  constructor: KBucket,

  // contact.id holds a BigEndian value.  traverse tree by bits (0: left, 1: right) unti non-null contacts is found.
  add: function (contact) {
    contact.id.length < 33 || err('ids cannot exceed 32 bytes')

    var bit = 0
    var node = this.root

    var byte = 0
    if (node.contacts === null) {
      // optimized loop
      var id = contact.id
      outer: for (byte = 0; byte < id.length; byte++) {
        for (bit = 0; bit < 8;) {
          node = (id[byte] & (0x80 >>> bit)) === 0 ? node.left : node.right
          bit++
          if (node.contacts !== null) { break outer }
        }
      }
    }

    // update
    var index = node.index_of(contact.id)
    if (index !== -1) {
      var prev = node.contacts[index]
      var next = this.arbiter(prev, contact)
      if (next === prev && prev !== contact) return

      node.contacts.splice(index, 1) // remove old contact
      node.contacts.push(next) // add more recent contact version
      this.emit('updated', prev, next)
      return this
    }

    // add
    if (node.contacts.length < this.bucket_len) {
      node.contacts.push(contact)
      this.emit('added', contact)
      return this
    }

    // split
    if (!node.far) {
      node.split(byte, bit, this.root_id)
      this.add(contact)
      return this
    }

    // ping

    // only if one of the pinged nodes does not respond, can the new contact
    // be added (this prevents DoS flodding with new invalid contacts)
    this.emit('ping', node.contacts.slice(0, this.num_to_ping), contact)
    return this
  },

  // return up to n closest contacts to the given id, according to the distance function
  closest: function (id, n) {
    if (n == null) { n = Infinity }
    n > 0 || err('expected positive count')
    var ret = []
    var stack = []
    var node = this.root
    var dist = this.distance

    // yes, the loop is ugly, but this version of the closest() function is running at 3x performance of the original version.
    outer: for (var byte = 0; byte < id.length; byte++) {
      for (var bit = 0; bit < 8;) {
        // optimized loop
        if (node.contacts === null) {
          if (id[byte] & (0x80 >>> bit)) {
            stack.push(node.left)
            node = node.right
          } else {
            stack.push(node.right)
            node = node.left
          }
          bit++
        } else {
          var contracts = node.contacts
          for (var j=0; j<contracts.length; j++) {
            contracts[j]._dist = dist(contracts[j].id, id)
            ret.push(contracts[j])
            // note: get the whole bucket of unordered contacts to sort and select below
          }
          if (ret.length >= n || stack.length === 0) {
            break outer
          }
          node = stack.pop()
        }
      }
    }
    ret.sort(function (a, b) { return a._dist - b._dist })
    if (ret.length > n) { ret.length = n }                  // we slurped up more than required
    return ret
  },

  // return the number of contracts
  count: function () {
    var ret = 0
    var stack = []
    var node = this.root
    while (true) {
      // optimized loop
      if (node.contacts === null) {
        stack.push(node.left)
        node = node.right
      } else {
        ret += node.contacts.length
        if (stack.length === 0) {
          return ret                      // RETURN
        }
        node = stack.pop()
      }
    }
  },

  get: function (id) {
    var node = this.root.leaf(id)
    var index = node.index_of(id)
    return index === -1 ? null : node.contacts[index]
  },

  remove: function (id) {
    var node = this.root.leaf(id)
    var index = node.index_of(id)
    if (index !== -1) {
      var contact = node.contacts.splice(index, 1)[0]
      this.emit('removed', contact)
    }
  },

  // return all contacts as an array
  all_contacts: function () { return this.root.all_contacts() },
  toArray: function () { return this.root.all_contacts() },       // backward compatible

  to_obj: function () {
    return this.root.to_obj()
  }
}

inherits(KBucket, EventEmitter)

// return the XOR distance between two ids (buffers)
//
// According to http://www.maymounkov.org/papers/maymounkov-kademlia-lncs.pdf, the distance
// measure (XOR) has these necessary properties:
//
//    1.  d(x,x) = 0
//    2.  d(x,y) > 0, if x != y
//    3.  forall x,y : d(x,y) = d(y,x) (symmetry)
//    4.  d(x,z) <= d(x,y) + d(y,z)    (triangle inequality)
//
function distance (a, b) {

  // optimized.  performs about 35% faster than the straight-forward version
  var ret = 0
  var i = 0
  var maxlen = a.length
  if (b.length === maxlen) {
    for(; i < maxlen; i++) { ret = (ret << 8) | (a[i] ^ b[i]) }
  } else {
    // handle different lengths
    var maxnode
    var minlen
    if (b.length > maxlen) {
      maxnode = b
      maxlen = b.length
      minlen = a.length
    } else {
      maxnode = a
      minlen = b.length
      // maxlen is set
    }
    for (; i < minlen; i++) { ret = (ret << 8) | (a[i] ^ b[i]) }
    for (; i < maxlen; i++) { ret = (ret << 8) | maxnode[i] }
  }
  return ret
}

function arr_equals (a, b) {
  if (a === b) {
    return true
  }
  if (a.length !== b.length) {
    return false
  }
  for (var i = 0, length = a.length; i < length; i++) {
    if (a[i] !== b[i]) {
      return false
    }
  }
  return true
}

function Node () {
  this.contacts = []
  this.left = null
  this.right = null
  this.far = false
  this._dist = 0
}

Node.prototype = {
  constructor: Node,

  // redistribute contacts to left/right nodes.
  split: function (byte, bit, root_id) {
    this.left = new Node()
    this.right = new Node()
    var contacts = this.contacts
    for (var i=0; i<contacts.length; i++) {
      var c = contacts[i]
      ;((c.id[byte] && (c.id[byte] & (0x80 >>> bit))) ? this.right : this.left).contacts.push(c)
    }
    this.contacts = null
    ;((root_id[byte] && (root_id[byte] & (0x80 >>> bit))) ? this.left : this.right).far = true
  },

  index_of: function (id) {
    var c = this.contacts
    for (var i = 0; i < c.length; i++) {
      if (arr_equals(c[i].id, id)) return i
    }
    return -1
  },

  leaf: function (id) {
    var ret = this
    // optimized loop
    for (var byte = 0; byte < id.length; byte++) {
      for (var bit = 0; bit < 8;) {
        if (ret.contacts !== null) {
          return ret
        }
        ret = id[byte] & (0x80 >>> bit) ? ret.right : ret.left
        bit++
      }
    }
  },

  all_contacts: function () {
    var ret = []
    var nodes = [this]
    while (nodes.length > 0) {
      var node = nodes.pop()
      if (node.contacts === null) nodes.push(node.right, node.left)
      else ret = ret.concat(node.contacts)
    }
    return ret
  },

  // Converts the graph starting at the given node into condensed minimal object form with tiny names and values
  // to facilitate debugging and testing.
  to_obj: function () {
    var self = this
    var ret = {}
    if (self.contacts == null) {
      self.id == null || err('unexpected id: ' + self.id)
      if (!is_empty(self.left)) { ret.l = self.left.to_obj() }
      if (!is_empty(self.right)) { ret.r = self.right.to_obj() }
    } else {
      if (self.contacts.length) {
        var idstr = self.contacts.map(function (c) {
          !(c.right || c.left) || err('mixed node')
          return c.id.toString('hex').toUpperCase()
        }).join(',')
        ret.b = (self.far ? '!' : '') + idstr
      }
    }
    return ret
  }
}

var DEFAULT_ID = null
function default_id (len) {
  if (!DEFAULT_ID) {
    var b = new Buffer(len)
    b[0] = 0x80
    for (var i=1; i<len; i++) { b[i] = 0 }
    DEFAULT_ID = b
  }
  return DEFAULT_ID
}

function err (msg) { throw Error (msg) }

function is_empty (n) { return n == null || (n.left == null && n.right == null && n.contacts.length === 0) }

KBucket.distance = distance

module.exports = KBucket
