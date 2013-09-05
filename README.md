angular-history
===============

A history service for AngularJS.  Undo/redo, that sort of thing.  Has nothing to do with the "back" button, unless you want it to.

Installation
============

```
bower install angular-history
```

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

Optionally, you can grab the [https://github.com/Ticore/ngLazyBind](ngLazyBind) module if you want to support lazy binding.  This becomes useful if you have say, an `<input type="text">` field,
and you don't want every keystroke recorded in the history.  If this
module is present, the `History` service will provide extra options.

Watching an Expression
----------------------

You will want to give the `History` service an expression to watch:

```javascript
angular.module('myApp').controller('MyCtrl', function($scope, History) {
    $scope.foo = 'bar';
    History.watch('foo', $scope);
});
```

An optional third parameter is the `description`, which will be emitted when an item is archived, undone, or redid, via a `$broadcast()`.  (TODO: `revert()` support.)  This allows you to attach to the event and do something with the info, such as pop up an alert with an "undo" button in it.  This value is interpolated against the passed `$scope` object.

If you have the `ngLazyBind` module, you may provide a fourth parameter to `History.watch()`:

```javascript
History.watch('foo', $scope, 'Foo changed to {{foo}}', {timeout: 500});
```

This tells the history stack to update no more often than every 500ms. This value defaults to 1s.  If you wish to use lazy binding with the default, then simply pass an empty object `{}` as the fourth parameter.  If you do not have the `ngLazyBind` module installed, this object will simply be ignored.

Undoing/Redoing
---------------

Once something is `watch()`ed, you can undo or redo changes to it, *if that expression is assignable*.  If you pass a function as the expression, you may not undo/redo, but you will still have access to the history stack.  Anyway, to undo, execute:

```javascript
History.undo('foo', $scope);
```

The `$scope` will be updated with the most recent verision of the object.  You can `undo()` as many times as there are changes in the expression's value since you `watch()`ed it.

Furthermore, an event will be emitted.  The `$rootScope` will `$broadcast()` a `History.undone` event with the following information:

- `expression`: The expression that was undone
- `oldValue`: The value the expression was changed to
- `newValue`: The value the expression was before this (maybe these names should switch?)
- `description`: The optional `description` you may have passed when
- `scope`: The scope passed to `undo()`

Redoing is pretty much as you would expect:

```javascript
History.redo('foo', $scope);
```

This only works if you have previously undone something, of course.  You can undo multiple times, then redo multiple times.  The event emitted after redo is `History.redone` and the information is the same.

Revert
------

You can revert to the original value at the time of the `watch()` instruction by issuing:

```javascript
History.revert('foo', $scope);
```

At the time of this writing, it does not emit a `History.reverted` event, but it should.

Forgetting
----------

If you want to stop watching an expression for changes, issue:

```javascript
History.forget('foo', $scope);
```

The history will be purged and the watch will be removed.

Fanciness: Deep Watching
------------------------

Maybe it could use a different name, but often situations arise where you want to watch an entire array of objects for a change in any of those objects' properties.  It would be incredibly inefficient to watch the entire array/object for changes, and you wouldn't necessarily know what property got updated.  This is still a very new feature, but you can do it like so:

```javascript
$scope.foos = [
  {id: 1, name: 'winken'},
  {id: 2, name: 'blinken'},
  {id: 3, name: 'nod'}
];
History.deepWatch('f.name for f in foos', $scope, 'Foo with ID {{f.id}} changed to {{f.name}}');
```

This works for objects as well:

```javascript
$scope.foos = {
  '1': {name: 'fe'},
  '2': {name: 'fi'},
  '3': {name: 'fo'},
  '4': {name: 'fum'}
};
History.deepWatch('value.name for key, value in foos', $scope, 'Foo with ID {{key}} changed its name to {{value.name}}');
```

(Or at least, I think it does.  As you can see, no unit tests yet.)

Now, whenever a name of any one of those things changes, history will be put on the stack.

Internals
---------
To debug, you can grab the stack itself by asking the service for it:

```javascript
console.log(History.history);
```

Other properties of the `History` service include `pointers` (which keeps a pointer to the index in the `history` we are at), `watches` (which are the actual `$watch` functions on the Scope objects), and `descriptions` which stores any `description` parameters passed to `watch()`.

Questions and/or comments to @boneskull


