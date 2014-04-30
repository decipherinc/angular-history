/*global angular, sinon, console*/
(function () {
  'use strict';

  var Q = window.QUnit;

  function getArgs(spy, num) {
    return JSON.stringify(spy.getCall(num).args);
  }

  function log(o) {
    console.log(JSON.stringify(o));
  }

  var init = {
    setup: function () {
      var $injector = angular.injector(['ng', 'decipher.history', 'ngMock']);

      this.History = $injector.get('History');
      this.$rootScope = $injector.get('$rootScope');
      this.$log = $injector.get('$log');
      this.scope = this.$rootScope.$new();
      this.$timeout = $injector.get('$timeout');
      this.sandbox = sinon.sandbox.create('history');

    },
    teardown: function () {
      this.History.forget();
      this.sandbox.restore();
    }
  };

  Q.module('History', init);

  Q.test('_archive', 9, function () {
    var watch,
      History = this.History,
      scope = this.scope,
      $broadcast = this.sandbox.stub(this.$rootScope, '$broadcast'),
      locals = {baz: 'spam'};
    Q.ok(angular.isFunction(History._archive()),
      '_archive returns function');

    History.descriptions[scope.$id] = {foo: 'bar'};
    History.watchObjs[scope.$id] = {};
    History.watchObjs[scope.$id].foo = new History.Watch();
    watch = History._archive('foo', scope.$id, locals);
    watch('foo', 'foo', scope);

    Q.equal($broadcast.callCount, 0,
      '$broadcast() not called when arguments are identical');

    watch('derp', 'foo', scope);

    Q.equal($broadcast.callCount, 1,
      '$broadcast() called when pointer is 1');

    watch('herp', 'derp', scope);

    Q.equal($broadcast.callCount, 2,
      '$broadcast() called when arguments differ');

    Q.ok($broadcast.calledWithExactly('History.archived', {
      expression: 'foo',
      newValue: 'herp',
      oldValue: 'derp',
      description: 'bar',
      locals: locals}),
      '$broadcast called with specified args: ' + getArgs($broadcast, 1));

    Q.deepEqual(History.history[scope.$id].foo, ['foo', 'derp', 'herp'],
      'history stack is as expected: ' +
      JSON.stringify(History.history[scope.$id].foo));

    Q.deepEqual(History.pointers[scope.$id].foo, 2, 'pointer is as expected');

    watch = History._archive('foo', scope.$id, locals, true);

    watch('blah', 'herp');
    Q.deepEqual(History.history[scope.$id].foo, ['foo', 'derp', 'herp'],
      'history stack is as expected since we passed: ' +
      JSON.stringify(History.history[scope.$id].foo));

    watch('blah', 'herp');
    Q.deepEqual(History.history[scope.$id].foo, ['foo', 'derp', 'herp', 'blah'],
      'history stack is as expected since pass expired: ' +
      JSON.stringify(History.history[scope.$id].foo));


    History.descriptions = {};
  });

  Q.test('watch', 14, function () {
    var History = this.History,
      scope = this.scope,
      $watch = this.sandbox.spy(scope, '$watch'),
      _archive = this.sandbox.stub(History, '_archive');

    Q.throws(History.watch, 'watch() with no params throws err');
    Q.throws(function () {
      History.watch(undefined, {});
    }, 'watch() w/o exp param throws err');
    Q.throws(function () {
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

    // clean up watches
    angular.forEach(History.watches, function (expressions) {
      angular.forEach(expressions, function (watch) {
        watch();
      });
    });
  });

  Q.test('undoing, redoing, reverting', 24, function () {
    var scope = this.scope,
      History = this.History,
      _archive = this.sandbox.spy(History, '_archive'),
      $broadcast = this.sandbox.stub(this.$rootScope, '$broadcast'),
      warn = this.sandbox.stub(this.$log, 'warn');

    Q.throws(History.undo, 'throws err if no expression passed');
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
    Q.equal($broadcast.callCount, 2, '$broadcast happens on undo');
    Q.equal(scope.foo, 'bar', 'foo became bar again');
    scope.$apply(function () {
      History.undo('foo', scope);
    });
    Q.equal(scope.foo, 'bar', 'foo is still bar');
    Q.equal(warn.callCount, 1, 'warning emitted');

    scope.$apply(function () {
      History.redo('foo', scope);
    });
    Q.equal($broadcast.callCount, 3, '$broadcast happens on redo');
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
    scope.$apply(function () {
      History.revert('foo', scope);
    });
    Q.equal($broadcast.callCount, 6, '$broadcast happens on revert');
    Q.ok(!History.canUndo('foo', scope), 'assert we cannot undo');
    Q.ok(History.canRedo('foo', scope), 'assert we can redo');
    Q.equal(scope.foo, 'bar', 'foo is bar after revert');
    scope.$apply(function () {
      History.redo('foo', scope);
    });
    Q.equal(scope.foo, 'baz', 'foo is baz again');

    scope.$apply('butts = "feet"');
    History.watch('butts', scope);
    scope.$apply(function () {
      History.revert('butts', scope);
    });
    Q.equal(warn.callCount, 3, 'warning is emitted if nothing to revert');

    scope.$apply('butts = "hands"');
    scope.$apply('butts = "legs"');
    scope.$apply(function () {
      History.revert('butts', scope, 1);
    });

    Q.equal(scope.butts, 'hands', 'reverting to a specific pointer works');

  });

  Q.test('empty objects/arrays', 8, function () {
    var History = this.History,
      scope = this.scope;

    scope.$apply(function () {
      scope.hamburgers = [
        {
          pickles: [1, 2, 3]
        }
      ];
    });
    var e, s;

    scope.$on('History.archived', function (evt, data) {
      e = data.expression;
      s = data.locals;
    });
    scope.$apply(function () {
      History.deepWatch('h.pickles for h in hamburgers', scope);
    });
    scope.$apply('hamburgers[0].pickles.push(4)');

    Q.deepEqual(scope.hamburgers[0].pickles, [1, 2, 3, 4],
      'hamburgers is as expected');
    scope.$apply(function () {
      History.undo(e, s);
    });
    Q.deepEqual(scope.hamburgers[0].pickles, [1, 2, 3],
      'hamburgers has but three');

    scope.$apply(function () {
      History.deepWatch('p.pepperoni for p in pizzas', scope);
    });

    scope.$apply(function () {
      scope.pizzas = [
        {pepperoni: []}
      ];
    });

    var w = History.batch(function () {
      scope.$apply('pizzas[0].pepperoni.push(123)');
    }, scope)
      .addRollbackHandler('pizzaRollback', function () {
        Q.equal(scope.pizzas[0].pepperoni.length, 0, 'no pepperoni');
      });
    this.$timeout.flush();
    Q.equal(scope.pizzas[0].pepperoni.length, 1, 'got pepperoni');
    History.rollback(w.scope);

    scope.$apply(function() {
      delete scope.pizzas;
    });

    scope.$apply(function () {
      scope.pizzas = [
        {pepperoni: []}
      ];
    });

    w = History.batch(function () {
      scope.$apply('pizzas[0].pepperoni.push(123)');
    }, scope)
      .addRollbackHandler('pizzaRollback', function () {
        Q.equal(scope.pizzas[0].pepperoni.length, 0, 'no pepperoni');
      });
    this.$timeout.flush();
    Q.equal(scope.pizzas[0].pepperoni.length, 1, 'got pepperoni');
    History.rollback(w.scope);

    scope.$apply(function() {
      scope.pizzas.push({
        pepperoni: [123]
      });
    });

    w = History.batch(function () {
      scope.$apply('pizzas[1].pepperoni.push(456)');
    }, scope)
      .addRollbackHandler('pizzaRollback', function () {
        Q.equal(scope.pizzas[1].pepperoni.length, 1, 'a little pepperoni');
      });
    this.$timeout.flush();
    Q.equal(scope.pizzas[1].pepperoni.length, 2, 'got lots pepperoni');
    History.rollback(w.scope);


  });

  Q.test('forget', 6, function () {
    var History = this.History,
      scope = this.scope;

    scope.$apply('cows = "frogs"');
    scope.$apply('pigs = "chickens"');
    History.watch(['cows', 'pigs'], scope);
    scope.$apply('cows = "deer"');
    scope.$apply('pigs = "elk"');
    History.forget(scope, 'cows');
    Q.ok(angular.isUndefined(History.history[scope.$id].cows),
      'history undefined for cows');
    Q.ok(angular.isUndefined(History.pointers[scope.$id].cows),
      'pointers undefined for cows');
    Q.ok(angular.isUndefined(History.watches[scope.$id].cows),
      'watches undefined for cows');
    History.forget(scope, 'pigs');
    Q.ok(angular.isUndefined(History.history[scope.$id]),
      'history undefined for pigs');
    Q.ok(angular.isUndefined(History.pointers[scope.$id]),
      'pointers undefined for pigs');
    Q.ok(angular.isUndefined(History.watches[scope.$id]),
      'watches undefined for pigs');
  });

  Q.test('deepWatch', 13, function () {
    var History = this.History,
      scope = this.scope,
      handler;

    Q.throws(History.deepWatch, 'assert bad regex match throws error');

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

    scope.$apply(function () {
      History.deepWatch('v.name for (k, v) in data', scope,
        '{{k}} changed to {{v.name}}');
    });

    scope.$apply('data[1].name = "fred"');

    History.forget(scope);
    scope.$apply();

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
      History.deepWatch('d.name for d in data', scope,
        'name changed to {{d.name}}');
    });
    scope.$apply('data[0].name = "fred"');

    History.forget();
    scope.$apply();

    //TODO: for new feature wherein you can watch all members of all items of an array/object
//
//    var bigWatchStub = this.sandbox.stub();
//    History.deepWatch('d for d in data', scope)
//      .addChangeHandler('myChangeHandler', function($expression, $locals) {
//        History.undo($expression, $locals);
//        scope.$apply();
//      })
//      .addUndoHandler('myUndoHandler', bigWatchStub);
//
//    scope.$apply('data[0].name = "barney"');
//
//    Q.equal(bigWatchStub.callCount, 1, 'assert undo handler called');

  });

  Q.test('batching', 22, function () {
    var History = this.History,
      scope = this.scope;
    Q.throws(History.batch,
      'transaction fails when not passed a function');
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
    History.watch('foo', scope, 'foo array changed');
    History.watch('bar', scope, 'bar string changed');
    History.deepWatch('d.name for d in data', scope, 'name in data changed');
    History.deepWatch('od.name for (key, od) in otherdata', scope,
      'name in otherdata changed');

    scope.$apply('pigs = "chickens"');
    scope.$apply('foo = [4,5,6]');

    var t;
    scope.$on('History.batchEnded', function (evt, data) {
      t = data.transaction;
    });

    History.batch(function () {
      scope.$apply('foo[0] = 7');
      scope.$apply('foo[1] = 8');
      scope.$apply('foo[2] = 9');
      scope.$apply('data[0].name = "marvin"');
      scope.$apply('otherdata[1].name = "pookie"');
      scope.$apply('bar = "spam"');
      scope.$apply('pigs = "cows"');
    }, scope);

    this.$timeout.flush();

    Q.equal(scope.pigs, 'cows', 'pigs is now cows');
    Q.equal(scope.bar, 'spam', 'bar is now spam');
    Q.equal(scope.data[0].name, 'marvin', 'data[0].name is now marvin');
    Q.equal(scope.otherdata[1].name, 'pookie',
      'otherdata[1].name is now pookie');
    Q.deepEqual(scope.foo, [7, 8, 9], 'foo is [7,8,9]');

    scope.$on('History.rolledback', function (evt, data) {
      Q.deepEqual(data.bar.values, [
        {"oldValue": "spam", "newValue": "baz"}
      ], '"bar" changed values are as expected');
      Q.deepEqual(data.bar.descriptions, ["bar string changed"],
        '"bar" description(s) are as expected');
      Q.deepEqual(data.foo.values, [
        {"oldValue": [7, 8, 9], "newValue": [7, 8, 6]},
        {"oldValue": [7, 8, 6], "newValue": [7, 5, 6]},
        {"oldValue": [7, 5, 6], "newValue": [4, 5, 6]}
      ], '"foo" array values are as expected');
      Q.deepEqual(data.foo.descriptions, [
        "foo array changed",
        "foo array changed",
        "foo array changed"
      ], '"foo" descriptions are as expected');
      Q.deepEqual(data['d.name'].values, [
        {
          "newValue": "foo",
          "oldValue": "marvin"
        }
      ], '"d.name" values are as expected');
      Q.deepEqual(data['d.name'].descriptions, [
        "name in data changed"
      ], '"d.name" descriptions are as expected');
      Q.deepEqual(data['od.name'].values, [
        {
          "newValue": "foo",
          "oldValue": "pookie"
        }
      ], '"od.name" values are as expected');
      Q.deepEqual(data['od.name'].descriptions, [
        "name in otherdata changed"
      ], '"od.name" descriptions are as expected');

    });
    scope.$apply(function () {
      History.rollback(t);
    });

    Q.deepEqual(scope.foo, [4, 5, 6], 'foo is again [4,5,6]');
    Q.equal(scope.bar, 'baz', 'bar is again baz');
    Q.equal(scope.pigs, 'cows', 'pigs is still cows (no change)');
    Q.equal(scope.data[0].name, 'foo', 'data[0].name is again "foo"');
    Q.equal(scope.otherdata[1].name, 'foo', 'otherdata[1].name is again foo');

    History.undo('foo', scope);
    Q.deepEqual(scope.foo, [1, 2, 3], 'foo is again [1,2,3]');

    History.redo('foo', scope);
    Q.deepEqual(scope.foo, [4, 5, 6], 'foo is again [4,5,6]');
    Q.ok(!History.canRedo('foo', scope), 'assert no more history');

  });

  Q.test('Watch objects', 12, function () {
    var scope = this.scope,
      $broadcast = this.sandbox.stub(this.$rootScope, '$broadcast'),
      History = this.History,
      changeSpy = this.sandbox.spy(),
      undoSpy = this.sandbox.spy(),
      redoSpy = this.sandbox.spy(),
      revertSpy = this.sandbox.spy(),
      rollbackSpy = this.sandbox.spy();

    scope.$apply('bar = "baz"');
    scope.$apply(function () {
      scope.data = [
        {id: 1, name: 'foo'},
        {id: 2, name: 'bar'},
        {id: 3, name: 'baz'}
      ];
    });

    var w = History.watch('bar', scope)
      .addChangeHandler('changeSpy', function () {
        return changeSpy();
      })
      .addUndoHandler('undoSpy', function () {
        return undoSpy();
      })
      .addRedoHandler('redoSpy', function () {
        return redoSpy();
      })
      .addRevertHandler('revertSpy', function () {
        return revertSpy();
      });
    scope.$apply();

    scope.$apply('bar = "foo"');

    Q.equal(changeSpy.callCount, 1, 'change handler fired');

    scope.$apply(function () {
      History.undo('bar', scope);
    });

    Q.equal(undoSpy.callCount, 1, 'undo handler fired');

    scope.$apply(function () {
      History.redo('bar', scope);
    });

    Q.equal(redoSpy.callCount, 1, 'redo handler fired');

    scope.$apply(function () {
      History.revert('bar', scope);
    });

    Q.equal(revertSpy.callCount, 1, 'revert handler fired');

    w.removeChangeHandler('changeSpy')
      .removeUndoHandler('undoSpy')
      .removeRedoHandler('redoSpy')
      .removeRevertHandler('revertSpy');

    Q.equal(Object.keys(w.$handlers.$change), 0,
      'we removed the change handlers');
    Q.equal(Object.keys(w.$handlers.$undo), 0, 'we removed the undo ');
    Q.equal(Object.keys(w.$handlers.$redo), 0, 'we removed the redo ');
    Q.equal(Object.keys(w.$handlers.$revert), 0,
      'we removed the revert handlers');

    History.deepWatch('d.name for d in data', scope)
      .addRollbackHandler('rollbackSpy', function () {
        return rollbackSpy();
      });

    scope.$apply();

    w = History.batch(function () {
      scope.$apply('data[0].name = "omar"');
      scope.$apply('data[1].name = "little"');
    }, scope);

    scope.$apply();

    History.rollback(w.scope);

    w.removeRollbackHandler('rollbackSpy');

    Q.equal(Object.keys(w.$handlers.$rollback), 0,
      'we removed the rollback handlers');

    // Test ignoreEvent
    var callCount = $broadcast.callCount;
    w = History.watch('bar', scope);
    scope.$apply('bar = 1');
    Q.equal($broadcast.callCount, callCount + 1, 'Event is seen');
    w.ignoreEvent('History.archived', function () {
      // Ignore the event
      return true;
    });
    scope.$apply('bar = 2');
    Q.equal($broadcast.callCount, callCount + 1, 'Event is not seen');
    w.ignoreEvent('History.archived', function () {
      // Do not ignore the event
      return false;
    });
    scope.$apply('bar = 3');
    Q.equal($broadcast.callCount, callCount + 2, 'Event is seen again');
  });

  Q.test('Continue correctly after revert (or undo)', 4, function () {
    var scope = this.scope,
      History = this.History;

    scope.foo1 = {};
    scope.foo2 = {bar: 'baz'};
    scope.foo = scope.foo1;

    History.watch('foo', scope);
    scope.$apply();
    scope.$apply('foo = foo2');

    Q.deepEqual(History.history[scope.$id].foo, [{}, scope.foo2],
      'stack is as expected');

    History.undo('foo', scope);
    scope.$apply();

    Q.deepEqual(scope.foo, {}, 'foo is once again an empty object');
    Q.ok(scope.foo !== scope.foo1, 'foo is empty, but is NOT foo1');

    // modify the "foo" we received from the service.
    scope.$apply('foo.bar = "spam"');

    Q.deepEqual(History.history[scope.$id].foo, [{}, {bar: 'spam'}],
      'modification of foo does not affect stack');
  });
})();
