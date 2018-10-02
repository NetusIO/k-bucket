# k-bucket

Kademlia DHT K-bucket implementation as a binary tree.

This is a performance-optimized rewrite of the [webtorrent k-bucket](https://github.com/tristanls/k-bucket) using ES5
and zero runtime package dependencies for broader compatibility.  Development packages were also reduced from 555 to 43.

This implementation is **highly optimized** for javascript using for loops and even break labels (shudder)
in important areas.  The closest() function is almost **3x faster**, for example.
 
The rewrite uses [quickbit style](https://github.com/quicbit-js/qb-standard/blob/master/doc/recommended-style.md) 
for easier portability to C.

## External Changes

Most changes are the internal.

Pubic changes from the original include:

    Internal property names are shortened (though original public options names have been kept):
    
    localNodeId                 -> root_id
    numberOfNodesPerKBucket     -> bucket_len
    numberOfNodesToPing         -> num_to_ping

    (snake_case was chosen for parameters and functions to support easier porting to C) 
    
The root_id is no longer *randomly* generated when not provided.  It is simply generated as a
middle-value id (0x80000....).  If you would like to randomly generate it, just pass it in as a construction option.

Distance calculation for mismatched keys aligns now with the same logic used for traversing the graph, that
is, the missing lower-order bytes are defaulted to zero (instead of 0xFF).

Type checks such as those for UIntArray have been dropped in favor of duck-typing which reduces the 
code and test overhead and also implies using any sort of byte array should be possible.

Contacts objects now have a '_dist' distance property which is used by closest() to quickly sort values without creating
extra structures.  This property is modified and available on the contacts returned after calling closest().
They will change with the next closest() call that has them in scope.  It is up to clients to create
defensive copies if needed.

## Credits

Though this optimization of KBucket was a full rewrite, these folks have put in time to testing and 
modifying the original code over several years 
and it's important to give them credit - I use their original tests to ensure backward compatibility:

[@tristanls](https://github.com/tristanls), [@mikedeboer](https://github.com/mikedeboer), [@deoxxa](https://github.com/deoxxa), [@feross](https://github.com/feross), [@nathanph](https://github.com/nathanph), [@allouis](https://github.com/allouis), [@fanatid](https://github.com/fanatid), [@robertkowalski](https://github.com/robertkowalski), [@nazar-pc](https://github.com/nazar-pc), [@jimmywarting](https://github.com/jimmywarting)

## Installation

    npm install netus-k-bucket

## Tests

    npm test
    
## Sources

  - [Kademlia: A Peer-to-peer Information System Based on the XOR Metric](http://www.maymounkov.org/papers/maymounkov-kademlia-lncs.pdf)
  - [A formal specification of the Kademlia distributed hash table](http://maude.sip.ucm.es/kademlia/files/pita_kademlia.pdf)
