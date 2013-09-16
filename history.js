/*global angular*/

/**
 * It's a history service.
 *
 * Watches are registered against the scope if you pass it, otherwise $rootScope.
 */
(function () {
  'use strict';

  var DEEPWATCH_EXP = /^\s*(.*?)\s+for\s+(?:([\$\w][\$\w\d]*)|(?:\(\s*([\$\w][\$\w\d]*)\s*,\s*([\$\w][\$\w\d]*)\s*\)))\s+in\s+(.*?)$/,
    DEFAULT_TIMEOUT = 1000,
    lazyBindFound = false;

  // stub out lazyBind if we don't have it.
  try {
    angular.module('lazyBind');
    lazyBindFound = true;
  }
  catch (e) {
    angular.module('lazyBind', []).factory('$lazyBind', angular.noop);
  }

  angular.module('decipher.history', ['lazyBind']).service('History',
    function ($parse, $rootScope, $interpolate, $lazyBind, $timeout, $log) {
      var history = {},
        pointers = {},
        watches = {},
        lazyWatches = {},
        descriptions = {};

      /**
       * Evaluates an expression on the scope lazily.  That means it will return
       * a new value every DEFAULT_TIMEOUT ms at maximum, even if you change it between
       * now and then.  This allows us to $broadcast at an interval instead of after
       * every scope change.
       * @param {Scope} scope AngularJS Scope
       * @param {string} exp AngularJS expression to evaluate
       * @param {number} [timeout=DEFAULT_TIMEOUT] How often to change the value
       * @returns {Function}
       */
      var lazyWatch = function lazyWatch(scope, exp, timeout) {
        var bind = $lazyBind(scope);
        bind.cacheTime(timeout || DEFAULT_TIMEOUT);

        /**
         * This is the "expression function" we use to $watch with.  You normally
         * $watch a string, but you can also watch a function, and this is one of
         * those functions.  This is where the actual lazy evaluation happens.
         */
        return function () {
          return bind.call(scope, exp);
        };
      };

      /**
       * When an expression changes, store the information about it
       * and increment a pointer.
       * @param exp Expression
       * @param id Scope $id
       * @param {Scope} locals AngularJS scope
       * @param {boolean} pass Whether or not to pass on the first call
       * @param {string} description AngularJS string to interpolate
       * @return {Function} Watch function
       * @private
       */
      this._archive = function (exp, id, locals, pass, description) {
        return function (newVal, oldVal) {
          if (description) {
            descriptions[id][exp] = $interpolate(description)(locals);
          }
          if (pass) {
            pass = false;
            return;
          }
          // initializing a bunch of crap
          if (angular.isUndefined(history[id])) {
            history[id] = {};
          }
          if (angular.isUndefined(pointers[id])) {
            pointers[id] = {};
          }
          if (angular.isUndefined(history[id][exp])) {
            history[id][exp] = [];
          }
          if (angular.isUndefined(pointers[id][exp])) {
            pointers[id][exp] = 0;
          }
          history[id][exp].splice(pointers[id][exp] + 1);
          history[id][exp].push(angular.copy(newVal));
          // TODO convert types with __type__ if present
          pointers[id][exp] = history[id][exp].length - 1;

          if (pointers[id][exp] > 0) {
            $rootScope.$broadcast('History.archived', {
              expression: exp,
              newValue: newVal,
              oldValue: oldVal,
              description: descriptions[id][exp],
              locals: locals
            });
          }

        };
      };

      /**
       * Register some expression(s) for watching.
       * @param exps Array of expressions or one expression as a string
       * @param scope Scope
       * @param {string=} description Description of this change
       * @param {Object=} lazyOptions Options for lazy loading.  Only valid
       * property is 'timeout' at this point
       */
      this.watch = function watch(exps, scope, description, lazyOptions) {
        if (angular.isUndefined(exps)) {
          throw 'expression required';
        }
        scope = scope || $rootScope;
        description = description || '';
        var i,
          id = scope.$id,
          exp,
          model;

        if (!angular.isArray(exps)) {
          exps = [exps];
        }
        if (angular.isUndefined(watches[id])) {
          watches[id] = {};
        }
        if (angular.isUndefined(lazyWatches[id])) {
          lazyWatches[id] = {};
        }
        i = exps.length;
        while (i--) {
          exp = exps[i];

          // assert we have an assignable model
          // TODO: better way to do this?
          try {
            model = $parse(exp);
            model.assign(scope, model(scope));
          } catch (e) {
            throw new Error('expression "' + exp +
                            '" is not an assignable expression');
          }

          // blast any old watches
          if (angular.isFunction(watches[id][exp])) {
            watches[id][exp]();
          }

          if (!descriptions[id]) {
            descriptions[id] = {};
          }
          descriptions[id][exp] = $interpolate(description)(scope);

          this._watch(exp, scope, lazyOptions);

        }
      };

      /**
       * Allows you to watch an entire array/object full of objects, but only watch
       * a certain property of each object.  Usage:
       *
       *      History.deepWatch('foo.bar for foo in foos', $scope,
       *          'Changed foo {{foo.baz}}', {timeout: 1000});
       *
       *      History.deepWatch('key' + ': ' + val[key] for key, val in foos' ..)
       *
       *
       * @param exp
       * @param scope
       * @param description
       * @param lazyOptions
       */
      this.deepWatch =
      function deepWatch(exp, scope, description, lazyOptions) {
        var match,
          targetFn,
          targetName,
          valueFn,
          keyName,
          valuesFn,
          values,
          value,
          valueName,
          valuesName,
          that = this;
        description = description || '';
        if (!(match = exp.match(DEEPWATCH_EXP))) {
          throw new Error('expected expression in form of "_select_ for (_key_,)? _value_ in _collection_" but got "' +
                          exp + '"');
        }
        targetName = match[1];
        targetFn = $parse(targetName);
        valueName = match[4] || match[2];
        valueFn = $parse(valueName);
        keyName = match[3];
        valuesName = match[5];
        valuesFn = $parse(valuesName);
        values = valuesFn(scope);

        angular.forEach(values, function (v, k) {
          var locals = scope.$new(),
            id = locals.$id;
          locals[valueName] = v;
          if (keyName) {
            locals[keyName] = k;
          }
          value = valueFn(scope, locals);

          if (!watches[id]) {
            watches[id] = {};
          }
          if (!lazyWatches[id]) {
            lazyWatches[id] = {};
          }
          if (!descriptions[id]) {
            descriptions[id] = {};
          }
          descriptions[id][exp] = $interpolate(description)(locals);

          if (angular.isObject(lazyOptions) && lazyBindFound) {
            watches[id][targetName] = scope.$watch(lazyWatch(locals, targetName,
              lazyOptions.timeout || 500),
              that._archive(targetName, id, locals, false, description));
            lazyWatches[id][exp] = true;
          }
          else {
            watches[id][targetName] = scope.$watch(
              function (scope) {
                return targetFn(scope, locals);
              }, that._archive(targetName, id, locals, false, description));
            lazyWatches[id][exp] = false;
          }
        });
      };


      /**
       * Unregister some watched expression(s)
       * @param exps Array of expressions or one expression as a string
       * @param scope Scope
       */
      this.forget = function forget(exps, scope) {
        var i, id;
        scope = scope || $rootScope;
        id = scope.$id;
        if (!angular.isArray(exps) && angular.isString(exps)) {
          exps = [exps];
        }
        i = exps.length;
        while (i--) {
          if (angular.isDefined(watches[id][exps[i]])) {
            watches[id][exps[i]]();
          }
          delete watches[id][exps[i]];
          delete history[id][exps[i]];
          delete pointers[id][exps[i]];
          delete lazyWatches[id][exps[i]];
        }
      };

      /**
       * Internal function to change some value in the stack to another.
       * @param scope
       * @param exp
       * @param stack
       * @param pointer
       * @returns {{oldValue: *, newValue: null}}
       * @private
       */
      this._do = function _do(scope, exp, stack, pointer) {
        var model,
          oldValue,
          id = scope.$id;
        watches[id][exp]();
        model = $parse(exp);
        oldValue = model(scope);
        model.assign(scope, stack[pointer]);
        return {
          oldValue: oldValue,
          newValue: model(scope)
        };
      };

      /**
       * Undos an expression to last known value.
       * @param exp Expression
       * @param scope Scope
       */
      this.undo = function undo(exp, scope) {
        scope = scope || $rootScope;
        if (angular.isUndefined(exp)) {
          throw 'expression required';
        }
        var id = scope.$id,
          scopeHistory = history[id],
          stack,
          values,
          pointer;

        if (angular.isUndefined(scopeHistory)) {
          throw 'could not find history for scope ' + id;
        }

        stack = scopeHistory[exp];
        if (angular.isUndefined(stack)) {
          throw new Error('could not find history in scope "' + id +
                          ' against expression "' + exp + '"');
        }
        pointer = --pointers[id][exp];
        if (pointer < 0) {
          $log.warn('attempt to undo past history');
          pointers[id][exp]++;
          return;
        }
        values = this._do(scope, exp, stack, pointer);
        this._watch(exp, scope, true);

        $rootScope.$broadcast('History.undone', {
          expression: exp,
          oldValue: angular.copy(values.newValue),
          newValue: angular.copy(values.oldValue),
          description: descriptions[id][exp],
          scope: scope
        });


      };

      /**
       * Actually issues the appropriate scope.$watch
       * @param exp
       * @param scope
       * @param lazyOptions
       * @param pass
       * @private
       */
      this._watch = function _watch(exp, scope, pass, lazyOptions) {
        var id;
        scope = scope || $rootScope;
        pass = pass || false;
        id = scope.$id;

        // do we have an array or object?
        if (lazyBindFound && (angular.isObject(lazyOptions) ||
                              (lazyWatches[id] && !!lazyWatches[id][exp]))) {
          watches[id][exp] =
          scope.$watch(lazyWatch(scope, exp, lazyOptions.timeout),
            this._archive(exp, id, scope, pass));
          lazyWatches[id][exp] = true;
        }
        else {
          watches[id][exp] =
          scope.$watch(exp, this._archive(exp, id, scope, pass), true);
          lazyWatches[id][exp] = false;
        }

      };

      /**
       * Redos an expression.
       * @param exp Expression
       * @param scope Scope
       */
      this.redo = function redo(exp, scope) {
        scope = scope || $rootScope;
        var id = scope.$id,
          stack = history[id][exp],
          values,
          pointer;
        if (angular.isUndefined(stack)) {
          throw new Error('could not find history in scope "' + id +
                          ' against expression "' + exp + '"');
        }
        pointer = ++pointers[id][exp];
        if (pointer === stack.length) {
          $log.warn('attempt to redo past history');
          pointers[id][exp]--;
          return;
        }

        values = this._do(scope, exp, stack, pointer);
        this._watch(exp, scope, true);

        $rootScope.$broadcast('History.redone', {
          expression: exp,
          oldValue: angular.copy(values.newValue),
          newValue: angular.copy(values.oldValue),
          description: descriptions[id][exp],
          scope: scope
        });

      };

      /**
       * Whether or not we have accumulated any history for a particular expression.
       * @param exp Expression
       * @param scope Scope
       * @return {Boolean}
       */
      this.canUndo = function canUndo(exp, scope) {
        scope = scope || $rootScope;
        return angular.isDefined(pointers[scope.$id]) &&
               pointers[scope.$id][exp] > 0;
      };

      /**
       * Whether or not we can redo something
       * @param exp Expression
       * @param scope Scope
       * @returns {Boolean}
       */
      this.canRedo = function canRedo(exp, scope) {
        var id;
        scope = scope || $rootScope;
        id = scope.$id;
        return angular.isDefined(pointers[id]) &&
               angular.isDefined(pointers[id][exp]) &&
               pointers[id][exp] < history[id][exp].length - 1;
      };

      /**
       * Reverts to earliest known value of some expression.
       * @param exp Expression
       * @param scope Scope
       * @param {number} [pointer=0]
       */
      this.revert = function (exp, scope, pointer) {
        scope = scope || $rootScope;
        pointer = pointer || 0;
        var id = scope.$id,
          stack = history[id][exp],
          values;
        if (angular.isUndefined(stack)) {
          $log.warn('nothing to revert');
          return;
        }
        values = this._do(scope, exp, stack, pointer);

        // wait; what is this?
        history[scope.$id][exp].splice();
        pointers[scope.$id][exp] = pointer;
        this._watch(exp, scope, true);

        $rootScope.$broadcast('History.reverted', {
          expression: exp,
          oldValue: angular.copy(values.newValue),
          newValue: angular.copy(values.oldValue),
          description: descriptions[id][exp],
          scope: scope,
          pointer: pointer
        });
      };

      this.batch = function transaction(fn, scope) {
        var child;
        if (!angular.isFunction(fn)) {
          throw 'transaction requires a function';
        }
        if (!angular.isObject(scope)) {
          throw 'transaction requires a scope';
        }

        child = scope.$new();
        child.$on('$destroy', function () {

          angular.forEach(watches[child.$id], function (watch) {
            watch();
          });
          delete watches[child.$id];
          delete history[child.$id];
          delete pointers[child.$id];
          delete watches[child.$id];
        });

        pointers[child.$id] = angular.copy(pointers[scope.$id]);
        descriptions[child.$id] = angular.copy(descriptions[scope.$id]);
        lazyWatches[child.$id] = angular.copy(lazyWatches[scope.$id]);
        history[child.$id] = angular.copy(history[scope.$id]);
        watches[child.$id] = angular.copy(watches[scope.$id]);

        child.$on('History.archived', function (evt, data) {
          var deepChild,
            exp = data.expression,
            id;
          if (data.locals.$id !== child.$parent.$id) {
            deepChild = child.$new();
            deepChild.$$locals = data.locals;
            id = deepChild.$id;
            if (angular.isUndefined(history[id])) {
              history[id] = {};
            }
            if (angular.isUndefined(pointers[id])) {
              pointers[id] = {};
            }

            history[id][exp] =
            angular.copy(history[data.locals.$id][exp]);
            pointers[id][exp] =
            angular.isUndefined(pointers[id][exp]) ? 0 :
            pointers[id][exp] + 1;
          }
        });

        fn(scope);

        return child;
      };

      this.rollback = function rollback(t) {
        var _undo = this._do,
          $parent = t.$parent,
          packets = {},
          childHead,
          childHeadLocals,
          nextSibling,
          nextSiblingLocals,
          lastSiblingId;
        if (!t || !angular.isObject(t)) {
          throw 'must pass a transactional scope to rollback'
        }

        function _rollback(scope, comparisonScope) {
          var id = scope.$id,
            comparisonScopeId = comparisonScope.$id,
            stack = history[id],
            pointer,
            descs,
            exp,
            exps = Object.keys(stack),
            values,
            i = exps.length;
          while (i--) {
            exp = exps[i];
            values = [];
            descs = [];
            pointer = pointers[comparisonScopeId][exp];
            while (pointer > pointers[id][exp]) {
              pointer--;
              values.push(_undo(comparisonScope,
                exp, history[comparisonScopeId][exp], pointer));
              pointers[comparisonScopeId][exp] = pointer;
              descs.push(descriptions[comparisonScopeId][exp]);
              // throw this off the history stack so
              // we don't end up with it in the stack while we
              // do normal undo() calls later against the same
              // expression and scope
              history[comparisonScopeId][exp].pop();
            }
            packets[exp] = {
              values: values,
              scope: scope,
              comparisonScope: comparisonScope,
              descriptions: descs
            };
          }
        }

        _rollback(t, $parent);

        childHead = t.$$childHead;
        if (childHead) {
          childHeadLocals = childHead.$$locals;
          if (childHeadLocals) {
            _rollback(childHead, childHeadLocals);
          }

          while (nextSibling = childHead.$$nextSibling) {
            // I guess $$nextSibling is an infinite loop
            if (lastSiblingId === nextSibling.$id) {
              break;
            }
            nextSiblingLocals = nextSibling.$$locals;
            if (nextSiblingLocals) {
              _rollback(nextSibling, nextSiblingLocals);
            }
            lastSiblingId = nextSibling.$id;
          }
        }

        $rootScope.$broadcast('History.rolledback', packets);
      };

      // expose for debugging/testing
      this.history = history;
      this.descriptions = descriptions;
      this.pointers = pointers;
      this.watches = watches;
      this.lazyWatches = lazyWatches;
    });
})();
