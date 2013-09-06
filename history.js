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
          model,
          pointer,
          value,
          oldValue;

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
        // kill the watch so we can make this change.
        watches[id][exp]();
        model = $parse(exp);
        oldValue = value = model(scope);
        if (!angular.isObject(value) && !angular.isArray(value)) {
          model.assign(scope, stack[pointer]);
        }
        else {
          angular.extend(value, stack[pointer]);
        }

        this._watch(exp, scope, true);

        $rootScope.$broadcast('History.undone', {
          expression: exp,
          oldValue: angular.copy(stack[pointer]),
          newValue: angular.copy(oldValue),
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
        var id,
          model;
        scope = scope || $rootScope;
        pass = pass || false;
        id = scope.$id;
        model = $parse(exp);

        // do we have an array or object?
        if (angular.isArray(model(scope)) || angular.isObject(model(scope))) {
          if (lazyBindFound && (angular.isObject(lazyOptions) ||
                                (lazyWatches[id] && !!lazyWatches[id][exp]))) {
            watches[id][exp] =
            scope.$watchCollection(lazyWatch(scope, exp, lazyOptions.timeout),
              this._archive(exp, id, scope, pass));
            lazyWatches[id][exp] = true;
          }
          else {
            watches[id][exp] = scope.$watchCollection(exp,
              this._archive(exp, id, scope, pass));
            lazyWatches[id][exp] = false;
          }
        }
        else {
          if (lazyBindFound && (angular.isObject(lazyOptions) ||
                                (lazyWatches[id] && !!lazyWatches[id][exp]))) {
            watches[id][exp] =
            scope.$watch(lazyWatch(scope, exp, lazyOptions.timeout),
              this._archive(exp, id, scope, pass));
            lazyWatches[id][exp] = true;
          }
          else {
            watches[id][exp] =
            scope.$watch(exp, this._archive(exp, id, scope, pass));
            lazyWatches[id][exp] = false;
          }
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
          model,
          pointer,
          value,
          oldValue;
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
        watches[id][exp]();
        model = $parse(exp);
        oldValue = value = model(scope);
        if (!angular.isObject(value)) {
          model.assign(scope, stack[pointer]);
        }
        else {
          angular.extend(value, stack[pointer]);
        }

        this._watch(exp, scope, true);
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
        var id = scope.$id,
          stack = history[id][exp],
          model,
          pointer,
          value;
        if (angular.isUndefined(stack)) {
          $log.warn('nothing to revert');
          return;
        }
        watches[id][exp]();
        model = $parse(exp);
        value = model(scope);
        pointer = 0;
        if (!angular.isObject(value) && !angular.isArray(value)) {
          model.assign(scope, stack[pointer]);
        }
        else {
          angular.extend(value, stack[pointer]);
        }

        // wait; what is this?
        history[scope.$id][exp].splice();
        pointers[scope.$id][exp] = pointer;
        this._watch(exp, scope, true);
      };

      // expose for debugging/testing
      this.history = history;
      this.descriptions = descriptions;
      this.pointers = pointers;
      this.watches = watches;
      this.lazyWatches = lazyWatches;
    });
})();
