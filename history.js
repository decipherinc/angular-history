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
    function ($parse, $rootScope, $interpolate, $lazyBind, $timeout) {
      var history = {}, pointers = {}, watches = {}, descriptions = {};

      /**
       * This happens to be some of the most curious code I've ever written.
       * What it does is executes a $timeout every DEFAULT_TIMEOUT ms, outside
       * of the $digest loop.  The timeout does absolutely nothing except call itself
       * again.  The purpose of this is to keep the $watch callbacks executing at a
       * reasonable clip, because they are $evalAsync'd as per docs.  I believe simply
       * calling $timeout instructs the $evalAsync queue to process immediately.
       * Otherwise we can see lag in our UI if the $broadcast is not done regularly.
       */
      var digest = function digest() {
        $timeout(function () {
          digest();
        }, DEFAULT_TIMEOUT, true);
      };

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

      digest();
      /**
       * When an expression changes, store the information about it
       * and increment a pointer.
       * @param exp Expression
       * @param id Scope $id
       * @param {Scope} locals AngularJS scope
       * @return {Function} Watch function
       * @private
       */
      this._archive = function (exp, id, locals) {
        return function (newVal, oldVal) {
          if (newVal !== oldVal) {

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
              console.log('broadcasting');
              $rootScope.$broadcast('History.archived', {
                expression: exp,
                newValue: newVal,
                oldValue: oldVal,
                description: descriptions[id][exp],
                locals: locals
              });
            }
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
        scope = scope || $rootScope;
        var i, id = scope.$id, exp, model;

        if (!angular.isArray(exps) && angular.isString(exps)) {
          exps = [exps];
        }
        if (angular.isUndefined(watches[id])) {
          watches[id] = {};
        }
        i = exps.length;
        while (i--) {
          exp = exps[i];

          // assert we have an assignable model
          try {
            model = $parse(exp);
            model.assign(scope, model(scope));
          } catch (e) {
            throw new Error('expression "' + exp +
                            '" is not an assignable expression');
          }
          // save descriptions
          if (!descriptions[id]) {
            descriptions[id] = {};
          }
          descriptions[id][exp] = description;

          // blast any old watches
          if (angular.isFunction(watches[id][exp])) {
            watches[id][exp]();
          }

          // do we have an array?
          if (angular.isArray(model) || angular.isObject(model)) {
            if (angular.isObject(lazyOptions) && lazyBindFound) {
              watches[id][exp] =
              scope.$watchCollection(lazyWatch(scope, exp, lazyOptions.timeout),
                this._archive(exp, id, scope));
            }
            else {
              watches[id][exp] = scope.$watchCollection(exp,
                this._archive(exp, id, scope));
            }
          }
          else {
            if (angular.isObject(lazyOptions) && lazyBindFound) {
              watches[id][exp] =
              scope.$watch(lazyWatch(scope, exp, lazyOptions.timeout),
                this._archive(exp, id, scope));
            }
            else {
              watches[id][exp] =
              scope.$watch(exp, this._archive(exp, id, scope));
            }
          }
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
        var match, targetFn, valueFn, keyName, valuesFn, values, value, valueName,
          valuesName, that = this, targetName;
        if (!(match = exp.match(DEEPWATCH_EXP))) {
          throw new Error('expected expression in form of "_select_ (as _label_)? for (_key_,)? _value_ in _collection_" but got "' +
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
          var locals = scope.$new(), id = locals.$id;
          locals[valueName] = v;
          if (keyName) {
            locals[keyName] = k;
          }
          value = valueFn(scope, locals);

          // save descriptions
          if (!descriptions[id]) {
            descriptions[id] = {};
          }
          descriptions[id][targetName] = $interpolate(description)(locals);

          if (!watches[id]) {
            watches[id] = {};
          }

          if (angular.isObject(lazyOptions) && lazyBindFound) {
            watches[id][targetName] = scope.$watch(lazyWatch(locals, targetName,
              lazyOptions.timeout || 500),
              that._archive(targetName, id, locals));
          }
          else {
            watches[id][targetName] = scope.$watch(
              function (scope) {
                return targetFn(scope, locals);
              }, that._archive(targetName, id, locals));
          }
        });
      };


      /**
       * Unregister some watched expression(s)
       * @param exps Array of expressions or one expression as a string
       * @param scope Scope
       */
      this.forget = function forget(exps, scope) {
        scope = scope || $rootScope;
        var i;
        if (!angular.isArray(exps) && angular.isString(exps)) {
          exps = [exps];
        }
        i = exps.length;
        while (i--) {
          if (angular.isDefined(watches[exps[i]])) {
            watches[scope.$id][exps[i]]();
          }
          delete history[scope.$id][exps[i]];
          delete pointers[scope.$id][exps[i]];
        }
      };

      /**
       * Undos an expression to last known value.
       * @param exp Expression
       * @param scope Scope
       */
      this.undo = function undo(exp, scope) {
        scope = scope || $rootScope;
        var id = scope.$id,
          stack = history[id][exp],
          model,
          pointer,
          value,
          oldValue;
        if (angular.isUndefined(stack)) {
          throw new Error('could not find history in scope "' + id +
                          ' against expression "' + exp + '"');
        }

        pointer = --pointers[id][exp];
        if (pointer < 0) {
          return;
        }
        watches[id][exp]();

        model = $parse(exp);
        oldValue = value = model(scope);
        if (!angular.isObject(value) && !angular.isArray(value)) {
          model.assign(scope, stack[pointer]);
        }
        else {
          angular.extend(value, stack[pointer]);
        }

        watches[id][exp] =
        scope.$watch(exp, this._archive(exp, id, scope), true);
        $rootScope.$broadcast('History.undone', {
          expression: exp,
          oldValue: angular.copy(stack[pointer]),
          newValue: angular.copy(oldValue),
          description: descriptions[id][exp],
          scope: scope
        });
      };

      /**
       * Redos an expression.
       * @param exp Expression
       * @param scope Scope
       */
      this.redo = function redo(exp, scope) {
        scope = scope || $rootScope;
        var id = scope.$id, stack = history[id][exp], model, pointer, value, oldValue;
        if (angular.isUndefined(stack)) {
          throw new Error('could not find history in scope "' + id +
                          ' against expression "' + exp + '"');
        }
        pointer = ++pointers[id][exp];
        if (pointer === stack.length) {
          return;
        }
        watches[id][exp]();
        model = $parse(exp);
        oldValue = value = model(scope);
        if (!angular.isObject(value)) {
          model.assign(scope, stack[pointer]);
        }
        else {
          angular.extend(value, stack[pointer]);
        }
        watches[id][exp] =
        scope.$watch(exp, this._archive(exp, id, scope), true);
        $rootScope.$broadcast('History.redone', {
          expression: exp,
          oldValue: angular.copy(stack[pointer]),
          newValue: angular.copy(oldValue),
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
        scope = scope || $rootScope;
        return angular.isDefined(pointers[scope.$id]) &&
               angular.isDefined(pointers[scope.$id][exp]) &&
               pointers[scope.$id][exp] < history[scope.$id][exp].length - 1;
      };

      /**
       * Reverts to earliest known value of some expression.
       * @param exp Expression
       * @param scope Scope
       */
      this.revert = function (exp, scope) {
        scope = scope || $rootScope;
        var id = scope.$id, stack = history[id][exp], model;
        if (angular.isUndefined(stack)) {
          throw new Error('could not find history in scope "' + id +
                          ' against expression "' + exp + '"');
        }
        if (stack.length === 0) {
          return;
        }
        watches[id][exp]();
        model = $parse(exp);
        model.assign(scope, stack[0]);
        // wait; what is this?
        history[scope.$id][exp].splice();
        pointers[scope.$id][exp] = -1;
        watches[id][exp] =
        scope.$watch(exp, this._archive(exp, id, scope), true);
      };

    });
})();
