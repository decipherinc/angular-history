/*global angular, sinon*/
(function () {
  'use strict';

  var Q = window.QUnit;

  function getArgs(spy, num) {
    return JSON.stringify(spy.getCall(num).args);
  }

  var init = {
    setup: function () {
      var $injector = angular.injector(['ng', 'decipher.history', 'ngMock']);

      this.History = $injector.get('History');
      this.$rootScope = $injector.get('$rootScope');
      this.$log = $injector.get('$log');
      this.scope = this.$rootScope.$new();

      this.sandbox = sinon.sandbox.create();

    },
    teardown: function () {
      delete this.History;
      this.sandbox.restore();
    }
  };

  Q.module('History', init);

  Q.test('_archive', 10, function () {
    var watch,
      $broadcast = this.sandbox.stub(this.$rootScope, '$broadcast'),
      locals = {baz: 'spam'};
    Q.ok(angular.isFunction(this.History._archive()),
      '_archive returns function');

    this.History.descriptions['1'] = {foo: 'bar'};
    watch = this.History._archive('foo', 1, locals);
    watch('foo', 'foo', this.scope);

    Q.equal($broadcast.callCount, 0,
      '$broadcast() not called when arguments are identical');

    watch('derp', 'foo', this.scope);

    Q.equal($broadcast.callCount, 1,
      '$broadcast() called when pointer is 1');

    watch('herp', 'derp', this.scope);

    Q.equal($broadcast.callCount, 2,
      '$broadcast() called when arguments differ');

    Q.ok($broadcast.calledWithExactly('History.archived', {
      expression: 'foo',
      newValue: 'herp',
      oldValue: 'derp',
      description: 'bar',
      locals: locals}),
      '$broadcast called with specified args: ' + getArgs($broadcast, 1));

    Q.deepEqual(this.History.history['1'].foo, ['foo', 'derp', 'herp'],
      'history stack is as expected: ' +
      JSON.stringify(this.History.history[1].foo));

    Q.deepEqual(this.History.pointers['1'].foo, 2, 'pointer is as expected');

    Q.ok(angular.isUndefined(this.History.watches['1']),
      'watch is empty (need to call watch())');

    watch = this.History._archive('foo', 1, locals, true);

    watch('blah', 'herp');
    Q.deepEqual(this.History.history['1'].foo, ['foo', 'derp', 'herp'],
      'history stack is as expected since we passed: ' +
      JSON.stringify(this.History.history[1].foo));

    watch('blah', 'herp');
    Q.deepEqual(this.History.history['1'].foo, ['foo', 'derp', 'herp', 'blah'],
      'history stack is as expected since pass expired: ' +
      JSON.stringify(this.History.history[1].foo));


    this.History.descriptions = {};
  });

  Q.test('watch', function () {
    var History = this.History,
      scope = this.scope,
      $watch = this.sandbox.spy(scope, '$watch'),
      $watchCollection = this.sandbox.spy(scope, '$watchCollection'),
      _archive = this.sandbox.stub(History, '_archive');

    Q.raises(History.watch, 'watch() with no params throws err');
    Q.raises(function () {
      History.watch(undefined, {});
    }, 'watch() w/o exp param throws err');
    Q.raises(function () {
      History.watch(true);
    }, 'non-assignable expression throws err');

    scope.$apply('foo = "bar"');

    History.watch('foo', scope);

    Q.equal($watch.callCount, 1, 'assert $watch is called');
    Q.equal(_archive.callCount, 1, 'assert _archive is called');
    Q.strictEqual(_archive.getCall(0).args[0], 'foo',
      '1st call, first arg to _archive is correct');
    Q.strictEqual(_archive.getCall(0).args[1], scope.$id,
      '1st call, second arg is correct');
    Q.strictEqual(_archive.getCall(0).args[2], scope,
      '1st call, third arg is correct');

    Q.ok(!History.descriptions[scope.$id]['foo'],
      'no description entered since we passed none');

    History.watch('foo', scope, 'derp');

    Q.equal(_archive.callCount, 2, '_archive called again');

    Q.equal(History.descriptions[scope.$id]['foo'], 'derp',
      'description is stored');

    scope.$apply('bar = "baz"');

    History.watch(['foo', 'bar'], scope, 'foo or bar');

    Q.equal(_archive.callCount, 4, '_archive called again (twice)');

    Q.equal(History.descriptions[scope.$id]['foo'], 'foo or bar',
      'assert first expression is processed');

    Q.equal(History.descriptions[scope.$id]['bar'], 'foo or bar',
      'assert second expression is processed');

    scope.$apply('spam = [1, 2, 3]');

    // there is some sort of bug in $watchCollection, and if
    // you give it a proxy, it will die.  so we can't use the
    // _archive stub anymore.
    _archive.restore();

    History.watch('spam', scope);

    Q.equal($watchCollection.callCount, 1,
      'watchCollection is called on array');

    Q.equal($watchCollection.getCall(0).args[0], 'spam',
      '1st call, 1st arg to $watchCollection is correct');

    scope.$apply(function() {
      scope.spam.push(4);
    });
    Q.deepEqual(History.history[scope.$id]['spam'], [[1,2,3,4]], 'history knows about push');

    // can't do this because reasons
//    Q.strictEqual($watchCollection.getCall(0).args[1], History._archive,
//      '1st call, 2nd arg to $watchCollection is correct');

    scope.$apply(function () {
      scope.sausage = {
        1: 'bratwurst',
        2: 'weisswurst',
        3: 'kielbasa'
      };
    });

    History.watch('sausage', scope);

    Q.equal($watchCollection.callCount, 2,
      'watchCollection is called on object');

    Q.equal($watchCollection.getCall(1).args[0], 'sausage',
      '2nd call, 1st arg to $watchCollection is correct');


    // clean up watches
    angular.forEach(History.watches, function (expressions) {
      angular.forEach(expressions, function (watch) {
        watch();
      });
    });
  });

  Q.test('undoing, redoing, reverting', 20, function () {
    var scope = this.scope,
      History = this.History,
      _archive = this.sandbox.spy(History, '_archive'),
      $broadcast = this.sandbox.stub(this.$rootScope, '$broadcast'),
      warn = this.sandbox.stub(this.$log, 'warn');

    Q.raises(History.undo, 'throws err if no expression passed');
    scope.$apply('foo = "bar"');

    scope.$apply(function () {
      History.watch('foo', scope);
    });
    Q.equal(_archive.callCount, 1, 'assert _archive is called');

    Q.equal(scope.foo, 'bar', 'foo is bar');
    scope.$apply('foo = "baz"');
    Q.equal(scope.foo, 'baz', 'foo is now baz');
    scope.$apply(function () {
      History.undo('foo', scope);
    });
    Q.equal(scope.foo, 'bar', 'foo became bar again');
    scope.$apply(function () {
      History.undo('foo', scope);
    });
    Q.equal(scope.foo, 'bar', 'foo is still bar');
    Q.equal(warn.callCount, 1, 'warning emitted');

    scope.$apply(function () {
      History.redo('foo', scope);
    });
    Q.equal(warn.callCount, 1, 'warning not emitted');
    Q.equal(scope.foo, 'baz', 'foo is baz again');
    scope.$apply(function () {
      History.redo('foo', scope);
    });
    Q.ok(History.canUndo('foo', scope), 'assert we can undo');
    Q.ok(!History.canRedo('foo', scope), 'assert we cannot redo');
    Q.equal(warn.callCount, 2, 'warning is emitted');
    scope.$apply(function () {
      History.undo('foo', scope);
    });
    Q.equal(scope.foo, 'bar',
      'foo is yet again bar and we did not mess up our pointers');
    Q.ok(!History.canUndo('foo', scope), 'assert we cannot undo');
    Q.ok(History.canRedo('foo', scope), 'assert we can redo');

    scope.$apply(function () {
      History.redo('foo', scope);
    });
    History.revert('foo', scope);
    Q.ok(!History.canUndo('foo', scope), 'assert we cannot undo');
    Q.ok(History.canRedo('foo', scope), 'assert we can redo');
    Q.equal(scope.foo, 'bar', 'foo is bar after revert');
    scope.$apply(function () {
      History.redo('foo', scope);
    });
    Q.equal(scope.foo, 'baz', 'foo is baz again');

    scope.$apply('butts = "feet"');
    History.watch('butts', scope);
    History.revert('butts', scope);
    Q.equal(warn.callCount, 3, 'warning is emitted if nothing to revert');
  });

  Q.test('forget', 6, function () {
    var History = this.History,
      scope = this.scope;

    scope.$apply('cows = "frogs"');
    scope.$apply('pigs = "chickens"');
    History.watch(['cows', 'pigs'], scope);
    scope.$apply('cows = "deer"');
    scope.$apply('pigs = "elk"');
    History.forget(['cows', 'pigs'], scope);
    Q.ok(angular.isUndefined(History.history[scope.$id]['cows']),
      'history undefined for cows');
    Q.ok(angular.isUndefined(History.history[scope.$id]['pigs']),
      'history undefined for pigs');
    Q.ok(angular.isUndefined(History.pointers[scope.$id]['cows']),
      'pointers undefined for cows');
    Q.ok(angular.isUndefined(History.pointers[scope.$id]['pigs']),
      'pointers undefined for pigs');
    Q.ok(angular.isUndefined(History.watches[scope.$id]['cows']),
      'watches undefined for cows');
    Q.ok(angular.isUndefined(History.watches[scope.$id]['pigs']),
      'watches undefined for pigs');
  });

  Q.test('deepWatch', function () {
    var History = this.History,
      scope = this.scope,
      handler;

    Q.raises(History.deepWatch, 'assert bad regex match raises error');

    scope.data = {
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
    scope.$apply();

    handler = scope.$on('History.archived', function (evt, data) {
      Q.equal(data.newValue, 'fred', 'newVal is fred');
      Q.equal(data.oldValue, 'foo', 'oldVal is foo');
      Q.equal(data.expression, 'v.name', 'expression is v.name');
      Q.equal(data.description, '1 changed to fred', 'description is right');

      History.undo(data.expression, data.locals);
      Q.equal(scope.data[1].name, 'foo', 'name is foo again');

      History.redo(data.expression, data.locals);
      Q.equal(scope.data[1].name, 'fred', 'name is back to fred');
      handler();
    });

    scope.$apply(function() {
      History.deepWatch('v.name for (k, v) in data', scope, '{{k}} changed to {{v.name}}');
    });
    scope.$apply('data[1].name = "fred"');


    scope.data = [
      {id: 1, name: 'foo'},
      {id: 2, name: 'bar'},
      {id: 3, name: 'baz'}
    ];
    scope.$apply();

    handler = scope.$on('History.archived', function (evt, data) {
      Q.equal(data.newValue, 'fred', 'newVal is fred');
      Q.equal(data.oldValue, 'foo', 'oldVal is foo');
      Q.equal(data.expression, 'd.name', 'expression is d.name');
      Q.equal(data.description, 'name changed to fred', 'description is right');

      History.undo(data.expression, data.locals);
      Q.equal(scope.data[0].name, 'foo', 'name is foo again');

      History.redo(data.expression, data.locals);
      Q.equal(scope.data[0].name, 'fred', 'name is back to fred');
      handler();
    });
    scope.$apply(function () {
      History.deepWatch('d.name for d in data', scope, 'name changed to {{d.name}}');
    });
    scope.$apply('data[0].name = "fred"');

  });
})();
