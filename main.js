// Whole-script strict mode syntax
"use strict";


// Cool debugger written in Perl.
// perl -E "use Regexp::Debugger; 'ababc' =~ / (a|b) b+ c /x"

function Node(type, from, to) {
    this.type = type;
    this.from = from;
    this.to = to;
}

Node.prototype.patch = function (nextA, nextB) {
    this.nextA = nextA;
    this.nextB = nextB;
};

Node.prototype.match = function (state) {
    if (this.match(state)) {
        if (this.isEnd) {
            return true;
        }
        var newState = state.nextChar();
        var left = this.nextA.match(newState);
        if (!left && this.nextB) {
            return this.nextB.match(newState);
        }
    }
    return false;
};

Node.EMPTY = 'EMPTY';
Node.CHAR = 'CHAR';
Node.CHARSET = 'CHARSET';
Node.ALTR = 'ALTR';
Node.JOIN = 'JOIN';
Node.GROUP_BEGIN = 'GROUP_BEGIN';
Node.GROUP_END = 'GROUP_END';
Node.REPEAT = 'REPEAT';
Node.NOT_MATCH = 'NOT_MATCH';

// node types:
// - character
// - group
// - repeat
// - lookback

function State(str) {
    this.str = str;
    this.idx = 0;
    this.matches = {};
    this.data = {};
    this.counts = {};
}

State.prototype.incr = function() {
    this.idx += 1;
};

State.prototype.finished = function() {
    return this.idx >= this.str.length;
};

State.prototype.getCurrentChar = function() {
    return this.str[this.idx];
};

State.prototype.clone = function() {
    return clone(this);
};

State.prototype.recordMatch = function(idx, from, to) {
    this.matches[idx] = this.str.substring(from, to);
};

State.prototype.set = function(key, value) {
    this.data[key] = value;
};

State.prototype.get = function(key) {
    return this.data[key];
};

State.prototype.incCounts = function(idx) {
    return this.counts[idx] = (this.counts[idx] || -1) + 1;
};

function match(state, node) {
    var res;
    while (node) {
        var nextChar = state.getCurrentChar();

        switch (node.type) {
            case Node.REPEAT:
                // TODO: Reset values of groups.

                // StateCounters start at -1 -> first inc makes the counter
                // be zero.
                var counter = state.incCounts(node.id);
                if (counter < node.from) {
                    // Haven't matched the minimum number yet
                    // -> match one more time.
                    res = match(state.clone(), node.child);
                } else if (counter === node.to) {
                    // Have matched the maximum number
                    // -> nothing to change.
                    res = state;
                } else {
                    // match \in {from, to}
                    if (node.greedy) {
                        res = match(state.clone(), node.child);
                        if (!res) {
                            res = match(state.clone(), node.next);
                        }
                    } else {
                        res = match(state.clone(), node.next);
                        if (!res) {
                            res = match(state.clone(), node.child);
                        }
                    }
                    //
                    // if (!res) {
                    //     return state;
                    // }
                }
                return res;

            case Node.CHARSET:
                if (state.finished()) {
                    return false;
                }

                res = node.children.some(function(f) {
                    return f(nextChar);
                });

                if (node.not) {
                    res = !res;
                }

                if (res) {
                    state.incr();
                    node = node.next;
                } else {
                    return false;
                }
                break;


            case Node.CHAR:
                if (state.finished()) {
                    return false;
                }

                if (node.data === nextChar) {
                    state.incr();
                    node = node.next;
                } else {
                    return false;
                }
                break;
            case Node.ALTR:
                for (var i = 0; i < node.children.length; i++) {
                    res = match(state.clone(), node.children[i]);
                    if (res) {
                        return res;
                    }
                }
                return null;

            case Node.EMPTY:
            case Node.JOIN:
                node = node.next;
                break;

            case Node.GROUP_BEGIN:
                state.set(node.data, state.idx);

                node = node.next;
                break;

            case Node.GROUP_END:
                // If node.idx > 0, then it's a group to store the match.
                if (node.data > 0) {
                    var beginState = state.get(node.data);
                    state.recordMatch(node.data, beginState, state.idx);
                }

                // Case of: x(?=y)
                if (node.data < 0) {
                    state.idx = state.get(node.data);
                }

                node = node.next;
                break;

            case Node.NOT_MATCH:
                // Case of: x(?!y)
                res = match(state.clone(), node.child);
                if (res) {
                    return false;
                }
                node = node.next;
                break;

        }
    }

    if (node) {
        return false;
    }

    return state;
}

var idCounter = 0;

function retArr(nodes) {
    return [nodes[0], nodes[nodes.length - 1]];
}

function bText(str) {
    var nodeA, nodeB;

    if (str === '') {
        nodeA = new Node(Node.EMPTY);
        return [nodeA, nodeA];
    } else if (str.length === 1) {
        nodeA = new Node(Node.CHAR);
        nodeA.data = str;
        return [nodeA, nodeA];
    }

    var nodes = str.split('').map(function(ch, idx) {
        var node = new Node(Node.CHAR, idx, idx + 1);
        node.data = ch;
        return node;
    });
    for (var i = 0; i < nodes.length - 1; i++) {
        nodes[i].next = nodes[i + 1];
    }

    return retArr(nodes);
}

// If group should be a not-remember-group like `(?:x)`, then set
// `idx=0`.
function bGroup(idx, children) {
    var begin = new Node(Node.GROUP_BEGIN);
    var end = new Node(Node.GROUP_END);

    begin.data = end.data = idx;

    begin.next = children[0];
    children[1].next = end;

    return [begin, end];
}

function bFollowMatch(children) {
    var id = idCounter++;
    return bGroup(-id, children);
}

function bNotFollowMatch(children) {
    var node = new Node(Node.NOT_MATCH);
    node.child = children[0];
    return [node, node];
}

function bCharSet(isNot, str) {
    var nodeA = new Node(Node.CHARSET);
    nodeA.not = isNot;

    // TODO: Add proper parsing of charSet here.
    nodeA.children = str.split('').map(function(matchChar) {
        return function(inputChar) {
            return inputChar === matchChar;
        };
    });

    return [nodeA, nodeA];
}

// BuildDot is just a shorthand for a charSet excluding all newlines.
function bDot() {
    return bCharSet(true, '\n\r\u2028\u2029');
}

function bAlt() {
    var altr = new Node(Node.ALTR);
    var join = new Node(Node.JOIN);

    var children = Array.prototype.slice.call(arguments, 0);
    altr.children = children.map(function(list) {
        list[1].next = join;
        return list[0];
    });

    return [altr, join];
}

function bJoin() {
    var args = arguments;

    for (var i = 0; i < args.length - 1; i++) {
        args[i][1].next = args[i + 1][0];
    }

    return [args[0][0], args[args.length - 1][1]];
}


function bRepeat(greedy, from, to, children) {
    var node = new Node(Node.REPEAT);

    node.id = idCounter++;
    node.greedy = greedy;
    node.from = from;
    node.to = to;

    // Create a loop.
    node.child = children[0];
    children[1].next = node;

    return [node, node];
}

function bEmpty() {
    var node = new Node(Node.EMPTY);
    return [node, node];
}

function run() {
    // test('dabc', bJoin(
    //     bDot(),
    //     bGroup(
    //         1,
    //         bAlt(
    //             bText(''),
    //             bText('a')
    //         )
    //     ),
    //     bText('bc')
    // ), 4, {1: 'a'});

    test('abab', bJoin(
        bRepeat(true, 0, 100, bDot()),
        bGroup(
            1,
            bText('b')
        )
    ), 4, {1: 'b'});

    // test('abab', bJoin(
    //     bRepeat(false, 0, 100, bDot()),
    //     bGroup(
    //         1,
    //         bText('b')
    //     )
    // ), 2, {1: 'b'});

    // test('abcabd', bJoin(
    //     bGroup(
    //         1,
    //         bText('abd')
    //     )
    // ), 6, {1: 'abd'});

    // test('abcabd', bGroup(1, bJoin(
    //     bText('b'),
    //     bFollowMatch(
    //         bText('d')
    //     )
    // )), 5, { 1: 'b' });

    // test('abcabd', bGroup(1, bJoin(
    //     bText('b'),
    //     bNotFollowMatch(
    //         bText('c')
    //     )
    // )), 5, { 1: 'b' });
}


var groupCounter = 1;
function walk(node, inCharacterClass) {
    var arr;
    var res;
    switch (node.type) {
        case 'disjunction':
            arr = node.alternatives.map(walk);
            return bAlt(arr);

        case 'alternative':
            arr = node.terms.map(walk);
            return bJoin.apply(null, arr);

        case 'character':
            return bText(node.char);

        case 'quantifier':
            return bRepeat(node.greedy, node.min, node.max, walk(node.child));

        case 'group':
            res = walk(node.disjunction);
            if (node.behavior === 'onlyIfNot') {
                return bNotFollowMatch(res);
            } else {
                var idx;
                if (node.behavior === 'onlyIf') {
                    idx = -1;
                } else if (node.behavior === 'ignore') {
                    idx = 0;
                } else {
                    idx = groupCounter++;
                }
                return bGroup(idx, res);
            }
            return bGroup()
                // onlyIf
                // onlyIfNot

        case 'empty':
            return bEmpty();

        default:
            throw new Error('Unsupported node type: ' + node.type);
    }
}

function exec(matchStr, regExpStr) {
    // tests: 'abc', 'a+'

    var parseTree = parse(regExpStr);

    groupCounter = 1;
    var nodes = walk(parseTree);

    var startNode = bJoin(
        bRepeat(false, 0, matchStr.length + 1, bDot()),
        nodes//,
    )[0];

    var state = new State(matchStr);
    var endState = match(state, startNode);

    return endState;
}

function test(str, nodes, lastIdx, matches) {
    function fail(msg) {
        console.error(msg);
    }

    function pass() {
        console.log('PASSED TEST');
    }

    // Note: Add to each start node the /(.)*?/ pattern to make the match
    // work also from not only the beginning
    var startNode = bJoin(
        bRepeat(false, 0, str.length + 1, bDot()),
        nodes//,
    )[0];

    var state = new State(str);
    var endState = match(state, startNode);


    if (endState) {
        if (lastIdx === -1) {
            return fail('Got match but did not expect one');
        }

        if (endState.idx !== lastIdx) {
            return fail('State lastIdx does not match expected one');
        }

        if (Object.keys(endState.matches).length !== Object.keys(matches).length) {
            return fail('Matches number does not match');
        }

        for (var i in endState.matches) {
            if (matches[i] !== endState.matches[i]) {
                return fail('Expected match does not match');
            }
        }
    } else {
        if (lastIdx !== -1) {
            return fail('Did not match but expected to do so');
        }
    }

    pass();
}

