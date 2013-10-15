angular-history [![Build Status](https://travis-ci.org/decipherinc/angular-history.png?branch=master)](https://travis-ci.org/decipherinc/angular-history)
===============

A history service for AngularJS.  Undo/redo, that sort of thing.  Has nothing to
do with the "back" button, unless you want it to.

Current Version
===============
```
0.7.0
```

*Fair warning:* Until this project is at `1.0.0` the API is subject to change
and will likely break.

Installation
============

```
bower install angular-history
```

Requirements
============

- AngularJS 1.1.x+
- [ngLazyBind](https://github.com/Ticore/ngLazyBind) (optional)

Running Tests
-------------

Clone this repo and execute:

```
npm install
```

to grab the dependencies.  Then execute:
 
```
grunt test
```

to run the tests.  This will grab the test deps from [bower](http://bower.io),
and run them against [QUnit](http://qunitjs.com) in a local server on port 8000.

API Documentation
=================

[API Documentation](http://decipherinc.github.io/angular-history/docs)

Demo
====

For now, some in the [API documentation](http://decipherinc.github.io/angular-history/docs).

Usage
=====

First, include the `decipher.history` module in your application:

```javascript
angular.module('myApp', ['decipher.history']);
```

Next, you will want to inject the `History` service into your component:

```javascript
angular.module('myApp').controller('MyCtrl', function($scope, History) {
    // ...
});
```

Optionally, you can grab the [ngLazyBind](https://github.com/Ticore/ngLazyBind)
module if you want to support lazy binding.  This becomes useful if you have
say, an `<input type="text">` field, and you don't want every keystroke recorded
in the history.  If this module is present, the `History` service will provide
extra options.

Watching an Expression
----------------------

You will want to give the `History` service an expression to watch:

```javascript
angular.module('myApp').controller('MyCtrl', function($scope, History) {
    $scope.foo = 'bar';
    History.watch('foo', $scope);
});
```

An optional third parameter is the `description`, which will be emitted when an
item is archived, undone, redone, or reverted, via a `$broadcast()`.   This
allows you to attach to the event and do something with the info, such as pop up
 an alert with an "undo" button in it.  This value is interpolated against the
 passed `$scope` object.

If you have the `ngLazyBind` module, you may provide a fourth parameter to
`History.watch()`:

```javascript
History.watch('foo', $scope, 'Foo changed to {{foo}}', {timeout: 500});
```

This tells the history stack to update no more often than every 500ms. This
value defaults to 1s.  If you wish to use lazy binding with the default, then
simply pass an empty object `{}` as the fourth parameter.  If you do not have
the `ngLazyBind` module installed, this object will simply be ignored.

The `Watch` Object
------------------

Whenever you issue one of the following commands, you will receive a `Watch`
object:

- `History.watch()`
- `History.deepWatch()`
- `History.batch()`

This provides another layer of functionality on top of the events that the
`History` service will broadcast.  You can use these *chainable* objects to run
callbacks depending on the type of action that was taken:

```javascript
var w = History.watch('foo')
  .addChangeHandler('myChangeHandler', function() {
    console.log('foo got changed');
  })
  .addUndoHandler('myUndoHandler', function() {
    console.log('undid foo.  this message will self-destruct');
    w.removeUndoHandler('myUndoHandler');
  });
```

The general recommendation is to listen for the global events if you want
general functionality, and to use these `Watch` object callbacks for specific
functionality.

Undoing/Redoing
---------------

Once something is `watch()`ed, you can undo or redo changes to it, *if that
expression is assignable*.  If you pass a function as the expression, you may
*not* undo/redo, but you will still have access to the history stack.

Anyway, to undo, execute:

```javascript
History.undo('foo', $scope);
```

The `$scope` will be updated with the most recent version of the object.  You
can `undo()` as many times as there are changes in the expression's value since
you `watch()`ed it--this is an entire history stack.

Furthermore, an event will be emitted.  The `$rootScope` will `$broadcast()` a
`History.undone` event with the following information:

- `expression`: The expression that was undone
- `oldValue`: The value the expression was changed from.  This is a copy!
- `newValue`: The value the expression was changed to
- `description`: The optional `description` you may have passed
- `scope`: The scope passed to `undo()`

Redoing is pretty much as you would expect:

```javascript
History.redo('foo', $scope);
```

This only works if you have previously undone something, of course.  You can
undo multiple times, then redo multiple times.  The event emitted after redo is
`History.redone` and the information is the same.

Use `History.canUndo(exp, scope)` and `History.canRedo(exp, scope)` if you need
to know those things.

Revert
------

You can revert to the original value at the time of the `watch()` instruction by
issuing:

```javascript
History.revert('foo', $scope);
```

If you are looking at `History.history` and know where in the stack you want to
go, pass a third parameter and you will revert to a specific revision in the
stack:

```javascript
History.revert('foo', $scope, 23);
```

...which will revert directly to the 23rd revision, no questions asked.

In addition, the `History.reverted` event will return to you the `pointer` that
you passed it (which is `0` by default).

Forgetting
----------

If you want to stop watching an expression for changes, issue:

```javascript
History.forget($scope, 'foo');
```

The history will be purged and the watch will be removed.  Note that the `$scope` parameter comes first.  If you omit the second parameter, all of the history data and watches for the scope will be destroyed.  If you omit the first parameter, this will wipe the entire History service.

Fanciness: Deep Watching
------------------------

Maybe it could use a different name, but often situations arise where you want
to watch an entire array of objects for a change in any of those objects'
properties.  It would be incredibly inefficient to watch the entire array/object
for changes, and you wouldn't necessarily know what property got updated.

"Deep watch" like so:

```javascript
$scope.foos = [
  {id: 1, name: 'winken'},
  {id: 2, name: 'blinken'},
  {id: 3, name: 'nod'}
];
History.deepWatch('f.name for f in foos', $scope, 
  'Foo with ID {{f.id}} changed to {{f.name}}');
```

This works for objects as well:

```javascript
$scope.foos = {
  '1': {name: 'fe'},
  '2': {name: 'fi'},
  '3': {name: 'fo'},
  '4': {name: 'fum'}
};
History.deepWatch('value.name for (key, value) in foos', $scope, 
  'Foo with ID {{key}} changed its name to {{value.name}}');
```

Now, whenever a name of any one of those things changes, history will be put on
the stack.

There are two ways to handle this.

### Listen for an event

The first is to listen for the `History.archived` event:

```javascript
History.deepWatch('f.name for f in foos', $scope, 
  'Foo with ID {{f.id}} changed to {{f.name}}');

$scope.$on('History.archived', function(evt, data) {
  $scope.undo = function() {
    History.undo(data.expression, data.locals);
  };
});

$scope.foos[0].name = 'fuh';

```

So you can bind to `undo()` in your view, and it will undo the change to
`foos[0].name`.

`data`, as passed to the event handler, will look similar to the
`History.undone` event as mentioned above:

- `expression`: The expression that got archived, local to `locals`
- `oldValue`: The value the expression was changed from.  This is a copy!
- `newValue`: The value the expression was changed to.
- `description`: The optional `description` you may have passed
- `locals`: A scope containing your expression's value.  For example, above we
will have the object `f` available in `locals`, with a `name` property.

### Use a handler

The second way is to use a handler built into a `Watch` object:

```javascript
var w = History.deepWatch('f.name for f in foos', $scope,
  'Foo with ID {{f.id}} changed to {{f.name}}');

w.addChangeHandler('myChangeHandler', function($expression, $locals, foo) {
  $scope.undo = function() {
    console.log('undoing foo with name "' + foo.name + '"');
    History.undo($expression, $locals);
  });
}, {foo: 'f'});

$scope.foos[0].name = 'fuh';

```

There are two special injections into your change/undo/redo/etc. handlers:

- `$expression` The expression that changed.  This may be simple, like `foo`,
or complex like `f.name` if you have used a deep watch.
- `$locals` The scope against which the change was made.  If this is simple,
like in the case of a `History.watch()`, you probably don't need it.  But if
you are doing a deep watch, then you will want to use this, because it does not
represent the scope you originally started with!

`$expression` is not available in rollback handlers (discussed later).

Otherworldly Fanciness: Batching
--------------------------------

You can group a bunch of changes together and undo them all at once.  Note that
currently you must actually be watching the changed variables in some manner;
you must use `watch()` or `deepWatch()` first, then issue the batch.

```javascript
// setup some data
scope.$apply('foo = [1,2,3]');
scope.$apply('bar = "baz"');
scope.$apply(function () {
  scope.data = [
    {id: 1, name: 'foo'},
    {id: 2, name: 'bar'},
    {id: 3, name: 'baz'}
  ];
  scope.otherdata = {
    1: {
      name: 'foo'
    },
    2: {
      name: 'bar'
    },
    3: {
      name: 'baz'
    }
  };
});

// watch some of these things through various means
History.watch('foo', scope, 'foo array changed');
History.watch('bar', scope, 'bar string changed');
History.deepWatch('d.name for d in data', scope, 'name in data changed');
History.deepWatch('od.name for (key, od) in otherdata', scope,
  'name in otherdata changed');

// change some things outright
scope.$apply('pigs = "chickens"');
scope.$apply('foo = [4,5,6]');
```

Next we'll initiate a batch.  You will receive a special new scope within your
`Watch` object that you can then pass to `History.rollback()`, which will roll
back all changes made within the batch closure.  See below.

The function you pass to `History.batch()` will accept a scope parameter, and
that is actually a child scope of the real scope.  Changes are made here and
propagated to the parent's history.

Note the second parameter, which is optional and defaults to `$rootScope`,
just like the other functions in the API.

```javascript
var w = History.batch(function (child) {
  child.$apply('foo[0] = 7');
  child.$apply('foo[1] = 8');
  child.$apply('foo[2] = 9'); // 3 changes to "foo"
  child.$apply('data[0].name = "marvin"'); // one change to the "data" array
  child.$apply('otherdata[1].name = "pookie"'); // one change to the "otherdata" array
  child.$apply('bar = "spam"'); // change to a string
  child.$apply('pigs = "cows"'); // change to something *not* watched
}, scope);
```

*You do not have to use the `child` variable unless you want to*.  It's
perfectly legit, if you are in a digest loop already, to just make assignments.
The following is equivalent, again, if you are already in a digest (if you are
using this code in a controller, you are likely in a digest; if you're using
it in a directive, you may or may not be depending on what you're up to):

```javascript
var w = History.batch(function (child) {
  scope.foo[0] = 7;
  scope.foo[1] = 8;
  scope.foo[2] = 9;
  scope.data[0].name = "marvin";
  scope.otherdata[1].name = "pookie";
  scope.bar = "spam";
  scope.pigs = "cows";
}, scope);
```

Let's make sure to notify our lovely `console` that a rollback happened:

```javascript
w.addRollbackHandler('myRollbackHandler', function($locals) {
  // $locals is the same as the "transaction" property of the watch object "w"
  console.log('a rollback happened against scope ' + $locals.$id);
});
```

Now let's issue a rollback.  Note that you can also listen for the
`History.batchBegan` and `History.batchEnded` events that are broadcast from the
`$rootScope`, if you want to implement more general functionality.

```javascript
var transaction = w.transaction;
History.rollback(transaction);
```

Let's see what we ended up with by viewing some assertions:

```javascript
Q.deepEqual(scope.foo, [4, 5, 6], 'foo is again [4,5,6]');
Q.equal(scope.bar, 'baz', 'bar is again baz');
// no change here, because we didn't watch "pigs"
Q.equal(scope.pigs, 'cows', 'pigs is still cows (no change)');
Q.equal(scope.data[0].name, 'foo', 'data[0].name is again "foo"');
Q.equal(scope.otherdata[1].name, 'foo', 'otherdata[1].name is again foo');

// see that you can undo further in some cases
History.undo('foo', scope);
Q.deepEqual(scope.foo, [1, 2, 3], 'foo is again [1,2,3]');

// see you can redo again
History.redo('foo', scope);
Q.deepEqual(scope.foo, [4, 5, 6], 'foo is again [4,5,6]');

// but also that you can't redo past the rollback.
// I suppose this could change, but it would put a lot
// of extra crap in the history.
Q.ok(!History.canRedo('foo', scope), 'assert no more history');
```

This batching hasn't been tested with the "lazy" functionality mentioned earlier
(yet), but it will certainly help you support mass changes to many variables at
once, and be able to report those changes to the user.

Internals
---------
To debug, you can grab the stack itself by asking the service for it:

```javascript
console.log(History.history);
```

Properties of the `History` service include:

- `history` (the complete history stack for all of the scopes and expressions)
- `pointers` (which keeps a pointer to the index in the `history` we are at)
- `watches` (which are the actual `$watch` functions on the Scope objects)
- `lazyWatches` (which are the stored "lazy" watches if you are using them)
- `watchObjs` (which stores all `Watch` objects created)
- `descriptions` (which stores any `description` parameters passed to `watch()`)

Author
======

[Christopher Hiller](http://boneskull.github.io) at
[Decipher, Inc.](http://decipherinc.github.io)


