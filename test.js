var test = require('test-kit')('tape')
var KBucket = require('.')

function str2id (s) {
  return Buffer.from(s, 'hex')
}

function id2str (id) {
  return id && id.toString('hex').toUpperCase()
}

test('count', function (t) {
  t.table_assert([
    [ 'root_id', 'ids',                     'exp' ],
    [ '0A',      null,                      0 ],
    [ null,      '0A',                      1 ],
    [ null,      '0A,0A',                   1 ],
    [ null,      '0A,0A,FF,11,FF',          3 ],
    [ null,      '0A,0A,FF,11,FE,FF,FE,00', 5 ],
  ], function (root_id, ids) {
    var opt = {}
    if (root_id) { opt.root_id = str2id(root_id) }
    var kb = new KBucket(opt)
    if (ids) {
      ids.split(',').forEach(function (id) {kb.add({id: str2id(id)})})
    }
    return kb.count()
  })
})

test('get', function (t) {
  t.table_assert([
    [ 'opt',             'contracts',                                                   'get_id', 'exp' ],
    [ null,              null,                                                          'A1',     null ],
    [ null,              [ {id: 'A1'} ],                                                'A1',     { id: 'A1' } ],
    '# retrieve highest vtime (default arbiter)',
    [ null,              [ {id: '08', x: 1, vtime: 0}, {id: '08', x: 0, vtime: 1} ], '08',     { id: '08', x: 0, vtime: 1 } ],
    [ { root_id: '00' }, [ {id: '08', x: 1, vtime: 1}, {id: '08', x: 1, vtime: 0} ], '08',     { id: '08', x: 1, vtime: 1 } ],
  ], function (opt, contracts, get_id) {
    var kb = new KBucket(opt)
    if (contracts) {
      contracts.forEach(function (c) { c.id = str2id(c.id); kb.add(c) })
    }
    var ret = kb.get(str2id(get_id))
    if (ret) {
      ret.id = id2str(ret.id)
    }
    return ret
  })
})

test('get retrieves contact from nested leaf node', function (t) {
  var kBucket = new KBucket({localNodeId: Buffer.from([ 0x00, 0x00 ])})
  for (var i = 0; i < kBucket.numberOfNodesPerKBucket; ++i) {
    kBucket.add({ id: Buffer.from([ 0x80, i ]) }) // make sure all go into "far away" bucket
  }
  // cause a split to happen
  kBucket.add({ id: Buffer.from([ 0x00, i ]), find: 'me' })
  t.same(kBucket.get(Buffer.from([ 0x00, i ])).find, 'me')
  t.end()
})

test('all_contacts should return empty array if no contacts', function (t) {
  var kBucket = new KBucket()
  t.same(kBucket.all_contacts().length, 0)
  t.end()
})

test('all_contacts should return all contacts in an array arranged from low to high buckets', function (t) {
  t.plan(22)
  var kBucket = new KBucket({ localNodeId: Buffer.from([ 0x00, 0x00 ]) })
  var expectedIds = []
  for (var i = 0; i < kBucket.bucket_len; ++i) {
    kBucket.add({ id: Buffer.from([ 0x80, i ]) }) // make sure all go into "far away" bucket
    expectedIds.push(0x80 * 256 + i)
  }
  // cause a split to happen
  kBucket.add({ id: Buffer.from([ 0x00, 0x80, i - 1 ]) })
  // console.log(require('util').inspect(kBucket, {depth: null}))
  var contacts = kBucket.all_contacts()
  // console.log(require('util').inspect(contacts, {depth: null}))
  t.same(contacts.length, kBucket.bucket_len + 1)
  t.same(parseInt(contacts[0].id.toString('hex'), 16), 0x80 * 256 + i - 1)
  contacts.shift() // get rid of low bucket contact
  for (i = 0; i < kBucket.bucket_len; ++i) {
    t.same(parseInt(contacts[i].id.toString('hex'), 16), expectedIds[i])
  }
  t.end()
})


test('closest nodes are returned', function (t) {
  var kBucket = new KBucket()
  for (var i = 0; i < 0x12; ++i) kBucket.add({ id: Buffer.from([ i ]) })
  var contact = { id: Buffer.from([ 0x15 ]) } // 00010101
  var contacts = kBucket.closest(contact.id, 3)
  t.same(contacts.length, 3)
  t.same(contacts[0].id, Buffer.from([ 0x11 ])) // distance: 00000100
  t.same(contacts[1].id, Buffer.from([ 0x10 ])) // distance: 00000101
  t.same(contacts[2].id, Buffer.from([ 0x05 ])) // distance: 00010000
  t.end()
})

test('n is Infinity by default', function (t) {
  var kBucket = new KBucket({ localNodeId: Buffer.from([ 0x00, 0x00 ]) })
  for (var i = 0; i < 1e3; ++i) kBucket.add({ id: Buffer.from([ ~~(i / 256), i % 256 ]) })
  t.true(kBucket.closest(Buffer.from([ 0x80, 0x80 ])).length > 100)
  t.end()
})

test('closest nodes are returned (including exact match)', function (t) {
  var kBucket = new KBucket()
  for (var i = 0; i < 0x12; ++i) kBucket.add({ id: Buffer.from([ i ]) })
  var contact = { id: Buffer.from([ 0x11 ]) } // 00010001
  var contacts = kBucket.closest(contact.id, 3)
  t.same(contacts[0].id, Buffer.from([ 0x11 ])) // distance: 00000000
  t.same(contacts[1].id, Buffer.from([ 0x10 ])) // distance: 00000001
  t.same(contacts[2].id, Buffer.from([ 0x01 ])) // distance: 00010000
  t.end()
})

test('closest nodes are returned even if there isn\'t enough in one bucket', function (t) {
  var kBucket = new KBucket({ localNodeId: Buffer.from([ 0x00, 0x00 ]) })
  for (var i = 0; i < kBucket.bucket_len; i++) {
    kBucket.add({ id: Buffer.from([ 0x80, i ]) })
    kBucket.add({ id: Buffer.from([ 0x01, i ]) })
  }
  kBucket.add({ id: Buffer.from([ 0x00, 0x01 ]) })
  var contact = { id: Buffer.from([ 0x00, 0x03 ]) } // 0000000000000011
  var ids = kBucket.closest(contact.id, 22).map(function (c) { return [ id2str(c.id), c._dist.toString(16) ] })
  t.same(ids, [
    // expected:
    // id,    distance from '0003' (hex)
    [ '0001', '2' ],
    [ '0103', '100' ],
    [ '0102', '101' ],
    [ '0101', '102' ],
    [ '0100', '103' ],
    [ '0107', '104' ],
    [ '0106', '105' ],
    [ '0105', '106' ],
    [ '0104', '107' ],
    [ '010B', '108' ],
    [ '010A', '109' ],
    [ '0109', '10a' ],
    [ '0108', '10b' ],
    [ '010F', '10c' ],
    [ '010E', '10d' ],
    [ '010D', '10e' ],
    [ '010C', '10f' ],
    [ '0113', '110' ],
    [ '0112', '111' ],
    [ '0111', '112' ],
    [ '0110', '113' ],
    [ '8003', '8000' ]
  ])

  // console.log(require('util').inspect(kBucket, false, null))
  t.end()
})


test('equal vtime results in contact marked as most recent', function (t) {
  var kBucket = new KBucket()
  var contact = { id: Buffer.from('a'), vtime: 3 }
  kBucket.add(contact)
  kBucket.add({ id: Buffer.from('b') })
  kBucket.add(contact)
  t.same(kBucket.root.contacts[1], contact)
  t.end()
})

test('more recent vtime results in contact update and contact being marked as most recent', function (t) {
  var kBucket = new KBucket()
  var contact = { id: Buffer.from('a'), old: 'property', vtime: 3 }
  kBucket.add(contact)
  kBucket.add({ id: Buffer.from('b') })
  kBucket.add({ id: Buffer.from('a'), newer: 'property', vtime: 4 })
  t.same(kBucket.root.contacts[1].id, contact.id)
  t.same(kBucket.root.contacts[1].vtime, 4)
  t.same(kBucket.root.contacts[1].old, undefined)
  t.same(kBucket.root.contacts[1].newer, 'property')
  t.end()
})

test('should generate "updated"', function (t) {
  t.plan(2)
  var kBucket = new KBucket()
  var contact1 = { id: Buffer.from('a'), vtime: 1 }
  var contact2 = { id: Buffer.from('a'), vtime: 2 }
  kBucket.on('updated', function (oldContact, newContact) {
    t.same(oldContact, contact1)
    t.same(newContact, contact2)
    t.end()
  })
  kBucket.add(contact1)
  kBucket.add(contact2)
})

test('should generate event "updated" when updating a split node', function (t) {
  t.plan(3)
  var kBucket = new KBucket({
    localNodeId: Buffer.from('') // need non-random localNodeId for deterministic splits
  })
  for (var i = 0; i < kBucket.bucket_len + 1; ++i) {
    kBucket.add({ id: Buffer.from('' + i) })
  }
  t.false(kBucket.bucket)
  var contact1 = { id: Buffer.from('a'), vtime: 1 }
  var contact2 = { id: Buffer.from('a'), vtime: 2 }
  kBucket.on('updated', function (oldContact, newContact) {
    t.same(oldContact, contact1)
    t.same(newContact, contact2)
    t.end()
  })
  kBucket.add(contact1)
  kBucket.add(contact2)
})

test('add', function (t) {
  t.table_assert([
    [ 'lid', 'npb', 'addIds',            'exp' ],
    '# add existing contact',
    [ '80',  4,     '80',                { b: '80' } ],
    '# add single contact',
    [ '80',  4,     'C0',                { b: 'C0' } ],
    '# add no split',
    [ '80',  4,     '80,C0,E0,F0',       { b: '80,C0,E0,F0' } ],
    '# add with splits',
    [ '80',  4,     '80,C0,E0,F0,F8',    { r: {l: {b:'80'}, r: {b:'!C0,E0,F0,F8'}} } ],
    [ '80',  4,     '80,C0,E0,F0,00',    { l: {b: '!00'}, r: {b: '80,C0,E0,F0'} } ],
    [ '80',  4,     '80,C0,E0,F0,00,81', { l: {b: '!00'}, r: {l: {b:'80,81'}, r: {b:'!C0,E0,F0'}} } ],
    [ '80',  4,     '80,A0,00,70,71',    { l: {b: '!00,70,71'}, r: {b: '80,A0'} } ],
    [ '80',  4,     '81,82,83,84,85',    { r: {l: {l:{l:{l:{l:{b:'81,82,83'},r:{b:'!84,85'}}}}}} } ],
  ], function (lid, npb, addIds) {
    var kBucket = new KBucket({ localNodeId: Buffer.from(lid, 'hex'), numberOfNodesPerKBucket: npb })
    addIds.split(',').forEach(function (id) { kBucket.add({ id: Buffer.from(id, 'hex') }) })
    console.log(JSON.stringify(kBucket.to_obj()))
    return kBucket.to_obj()
  })
})

test('adding a contact places it in root node', function (t) {
  var kBucket = new KBucket()
  var contact = { id: Buffer.from('a') }
  kBucket.add(contact)
  t.same(kBucket.root.contacts, [ contact ])
  t.end()
})

test('adding an existing contact does not increase number of contacts in root node', function (t) {
  var kBucket = new KBucket()
  var contact = { id: Buffer.from('a') }
  kBucket.add(contact)
  kBucket.add({ id: Buffer.from('a') })
  t.same(kBucket.root.contacts.length, 1)
  t.end()
})

test('adding same contact moves it to the end of the root node (most-recently-contacted end)', function (t) {
  var kBucket = new KBucket()
  var contact = { id: Buffer.from('a') }
  kBucket.add(contact)
  t.same(kBucket.root.contacts.length, 1)
  kBucket.add({ id: Buffer.from('b') })
  t.same(kBucket.root.contacts.length, 2)
  t.true(kBucket.root.contacts[0] === contact) // least-recently-contacted end
  kBucket.add(contact)
  t.same(kBucket.root.contacts.length, 2)
  t.true(kBucket.root.contacts[1] === contact) // most-recently-contacted end
  t.end()
})

test('adding contact to bucket that can\'t be split results in calling "ping" callback', function (t) {
  t.plan(3 /* num_to_ping */ + 2)
  var kBucket = new KBucket({ localNodeId: Buffer.from([ 0x00, 0x00 ]) })
  kBucket.on('ping', function (contacts, replacement) {
    t.same(contacts.length, kBucket.num_to_ping)
    // console.dir(kBucket.root.right.contacts[0])
    for (var i = 0; i < kBucket.num_to_ping; ++i) {
      // the least recently contacted end of the node should be pinged
      t.true(contacts[i] === kBucket.root.right.contacts[i])
    }
    t.same(replacement, { id: Buffer.from([ 0x80, j ]) })
    t.end()
  })
  for (var j = 0; j < kBucket.bucket_len + 1; ++j) {
    kBucket.add({ id: Buffer.from([ 0x80, j ]) }) // make sure all go into "far away" node
  }
})

test('should generate event "added" once', function (t) {
  t.plan(1)
  var kBucket = new KBucket()
  var contact = { id: Buffer.from('a') }
  kBucket.on('added', function (newContact) {
    t.same(newContact, contact)
  })
  kBucket.add(contact)
  kBucket.add(contact)
  t.end()
})

test('should generate event "added" when adding to a split node', function (t) {
  t.plan(2)
  var kBucket = new KBucket({
    localNodeId: Buffer.from('') // need non-random root_id for deterministic splits
  })
  for (var i = 0; i < kBucket.bucket_len + 1; ++i) {
    kBucket.add({ id: Buffer.from('' + i) })
  }
  t.same(kBucket.root.contacts, null)
  var contact = { id: Buffer.from('a') }
  kBucket.on('added', function (newContact) {
    t.same(newContact, contact)
  })
  kBucket.add(contact)
  t.end()
})

test('distance', function (t) {
  var kb = new KBucket()
  t.table_assert([
    [ 'id1',    'id2',     'exp' ],
    [ '00',     '00',      '0'],
    [ '00',     '01',      '1'],
    [ '01',     '00',      '1'],
    [ '01',     '02',      '3'],
    [ '02',     '01',      '3'],
    [ '00',     '02',      '2'],
    [ '15',     '11',      '4'],
    [ '00',     '0000',   '0'],
    [ '00',     '00FF',   'FF'],
    [ '00',     '7AFF',   '7AFF'],
    [ '01',     '24',      '25'],
    [ '24',     '01',      '25'],
  ], function (id1, id2) {
    return KBucket.distance( str2id(id1), str2id(id2)).toString(16).toUpperCase()
  })
})

test('removing a contact should remove contact from nested buckets', function (t) {
  var kBucket = new KBucket({ localNodeId: Buffer.from([ 0x00, 0x00 ]) })
  for (var i = 0; i < kBucket.bucket_len; ++i) {
    kBucket.add({ id: Buffer.from([ 0x80, i ]) }) // make sure all go into "far away" bucket
  }
  // cause a split to happen
  kBucket.add({ id: Buffer.from([ 0x00, i ]) })
  // console.log(require('util').inspect(kBucket, false, null))
  var contactToDelete = { id: Buffer.from([ 0x80, 0x00 ]) }
  t.same(kBucket.root.right.index_of(contactToDelete.id), 0)
  kBucket.remove(Buffer.from([ 0x80, 0x00 ]))
  t.same(kBucket.root.right.index_of(contactToDelete.id), -1)
  t.end()
})

test('should generate "removed"', function (t) {
  t.plan(1)
  var kBucket = new KBucket()
  var contact = { id: Buffer.from('a') }
  kBucket.on('removed', function (removedContact) {
    t.same(removedContact, contact)
    t.end()
  })
  kBucket.add(contact)
  kBucket.remove(contact.id)
})

test('should generate event "removed" when removing from a split bucket', function (t) {
  t.plan(2)
  var kBucket = new KBucket({
    localNodeId: Buffer.from('') // need non-random localNodeId for deterministic splits
  })
  for (var i = 0; i < kBucket.bucket_len + 1; ++i) {
    kBucket.add({ id: Buffer.from('' + i) })
  }
  t.false(kBucket.bucket)
  var contact = { id: Buffer.from('a') }
  kBucket.on('removed', function (removedContact) {
    t.same(removedContact, contact)
    t.end()
  })
  kBucket.add(contact)
  kBucket.remove(contact.id)
})


test('adding a contact does not split node', function (t) {
  var kBucket = new KBucket()
  kBucket.add({ id: Buffer.from('a') })
  t.same(kBucket.root.left, null)
  t.same(kBucket.root.right, null)
  t.notSame(kBucket.root.contacts, null)
  t.end()
})

test('adding maximum number of contacts (per node) [20] into node does not split node', function (t) {
  var kBucket = new KBucket()
  for (var i = 0; i < kBucket.bucket_len; ++i) {
    kBucket.add({ id: Buffer.from('' + i) })
  }
  t.same(kBucket.root.left, null)
  t.same(kBucket.root.right, null)
  t.notSame(kBucket.root.contacts, null)
  t.end()
})

test('adding maximum number of contacts (per node) + 1 [21] into node splits the node', function (t) {
  var kBucket = new KBucket()
  for (var i = 0; i < kBucket.bucket_len + 1; ++i) {
    kBucket.add({ id: Buffer.from('' + i) })
  }
  t.notSame(kBucket.root.left, null)
  t.notSame(kBucket.root.right, null)
  t.same(kBucket.root.contacts, null)
  t.end()
})

test('split nodes contain all added contacts', function (t) {
  t.plan(20 /* bucket_len */ + 2)
  var kBucket = new KBucket({ localNodeId: Buffer.from([ 0x00 ]) })
  var foundContact = {}
  for (var i = 0; i < kBucket.bucket_len + 1; ++i) {
    kBucket.add({ id: Buffer.from([ i ]) })
    foundContact[i] = false
  }
  var traverse = function (node) {
    if (node.contacts === null) {
      traverse(node.left)
      traverse(node.right)
    } else {
      node.contacts.forEach(function (contact) {
        foundContact[parseInt(contact.id.toString('hex'), 16)] = true
      })
    }
  }
  traverse(kBucket.root)
  Object.keys(foundContact).forEach(function (key) { t.true(foundContact[key], key) })
  t.same(kBucket.root.contacts, null)
  t.end()
})

test('when splitting nodes the "far away" node should be marked to prevent splitting "far away" node', function (t) {
  t.plan(5)
  var kBucket = new KBucket({ localNodeId: Buffer.from([ 0x00 ]) })
  for (var i = 0; i < kBucket.bucket_len + 1; ++i) {
    kBucket.add({ id: Buffer.from([ i ]) })
  }
  // above algorithm will split left node 4 times and put 0x00 through 0x0f
  // in the left node, and put 0x10 through 0x14 in right node
  // since root_id is 0x00, we expect every right node to be "far" and
  // therefore marked as "far = true"
  // there will be one "left" node and four "right" nodes (t.expect(5))
  var traverse = function (node, dontSplit) {
    if (node.contacts === null) {
      traverse(node.left, false)
      traverse(node.right, true)
    } else {
      if (dontSplit) t.true(node.far)
      else t.false(node.far)
    }
  }
  traverse(kBucket.root)
  t.end()
})
