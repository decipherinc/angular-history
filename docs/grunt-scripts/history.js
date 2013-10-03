/*global angular*/

/**
 * @ngdoc overview
 * @name decipher.history
 * @description
 * A history service for AngularJS.  Undo/redo, that sort of thing.  Has nothing to do with the "back" button, unless you want it to.
 *
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

  /**
   * @ngdoc service
   * @name decipher.history.service:History
   * @description
   * Provides an API for keeping a history of model values.
   */
  angular.module('decipher.history', ['lazyBind']).service('History',
    function ($parse, $rootScope, $interpolate, $lazyBind, $timeout, $log,
      $injector) {
      var history = {},
        pointers = {},
        watches = {},
        watchObjs = {},
        lazyWatches = {},
        descriptions = {},
        batching = false, // whether or not we are currently in a batch
        deepWatchId = 0; // incrementing ID of deep {@link decipher.history.object:Watch Watch instance}s

      /**
       * @ngdoc object
       * @name decipher.history.object:Watch
       * @overview
       * @constructor
       * @description
       * An object instance that provides several methods for executing handlers after
       * certain changes have been made.
       *
       * Each function return the `Watch` instance, so you can chain the calls.
       *
       * See the docs for {@link decipher.history.service:History#deepWatch History.deepWatch()} for an example of using these functions.
       */
      var Watch = function Watch(t) {
        this.transaction = t;
        this._changeHandlers = {};
        this._undoHandlers = {};
        this._rollbackHandlers = {};
        this._redoHandlers = {};
        this._revertHandlers = {};
      };

      /**
       * @description
       * Helper method for the add*Handler functions.
       * @param {string} where Type of handler, corresponds to object defined in constructor
       * @param {string} name Name of handler to be supplied by user
       * @param {Function} fn Handler function to execute
       * @param {Object} resolve Mapping of function parameters to values
       * @private
       * @returns {Watch} This {@link decipher.history.object:Watch Watch instance}
       */
      Watch.prototype._addHandler =
      function _addHandler(where, name, fn, resolve) {
        if (!where || !name || !fn) {
          throw 'invalid parameters to _addHandler()';
        }
        this[where][name] = {
          fn: fn,
          resolve: resolve
        };
        return this;
      };

      /**
       * @description
       * Helper method for remove*Handler functions.
       * @param {string} where Type of handler, corresponds to object defined in constructor
       * @param {string} name Name of handler to be supplied by user
       * @private
       * @returns {Watch} This {@link decipher.history.object:Watch Watch instance}
       */
      Watch.prototype._removeHandler = function (where, name) {
        if (!name) {
          throw 'invalid parameters to _removeHandler()';
        }
        delete this[where][name];
        return this;
      };

      /**
       * @ngdoc function
       * @name decipher.history.object:Watch#addChangeHandler
       * @methodOf decipher.history.object:Watch
       * @method
       * @param {string} name Unique name of handler
       * @param {Function} fn Function to execute upon change
       * @param {object} resolve Mapping of function parameters to values
       * @description
       * Adds a change handler function with name `name` to be executed
       * whenever a value matching this watch's expression changes (is archived).
       * @returns {Watch} This {@link decipher.history.object:Watch Watch instance}
       */
      Watch.prototype.addChangeHandler =
      function addChangeHandler(name, fn, resolve) {
        return this._addHandler('_changeHandlers', name, fn, resolve);
      };
      /**
       * @ngdoc function
       * @name decipher.history.object:Watch#addUndoHandler
       * @methodOf decipher.history.object:Watch
       * @method
       * @param {string} name Unique name of handler
       * @param {Function} fn Function to execute upon change
       * @param {object} resolve Mapping of function parameters to values
       * @description
       * Adds an undo handler function with name `name` to be executed
       * whenever a value matching this watch's expression is undone.
       * @returns {Watch} This {@link decipher.history.object:Watch Watch instance}
       */
      Watch.prototype.addUndoHandler =
      function addUndoHandler(name, fn, resolve) {
        return this._addHandler('_undoHandlers', name, fn, resolve);
      };
      /**
       * @ngdoc function
       * @name decipher.history.object:Watch#addRedoHandler
       * @methodOf decipher.history.object:Watch
       * @method
       * @param {string} name Unique name of handler
       * @param {Function} fn Function to execute upon change
       * @param {object} resolve Mapping of function parameters to values
       * @description
       * Adds a redo handler function with name `name` to be executed
       * whenever a value matching this watch's expression is redone.
       * @returns {Watch} This {@link decipher.history.object:Watch Watch instance}
       */
      Watch.prototype.addRedoHandler =
      function addRedoHandler(name, fn, resolve) {
        return this._addHandler('_redoHandlers', name, fn, resolve);
      };
      /**
       * @ngdoc function
       * @name decipher.history.object:Watch#addRevertHandler
       * @methodOf decipher.history.object:Watch
       * @method
       * @param {string} name Unique name of handler
       * @param {Function} fn Function to execute upon change
       * @param {object} resolve Mapping of function parameters to values
       * @description
       * Adds a revert handler function with name `name` to be executed
       * whenever a value matching this watch's expression is reverted.
       * @returns {Watch} This {@link decipher.history.object:Watch Watch instance}
       */
      Watch.prototype.addRevertHandler =
      function addRevertHandler(name, fn, resolve) {
        return this._addHandler('_revertHandlers', name, fn, resolve);
      };
      /**
       * @ngdoc function
       * @name decipher.history.object:Watch#addChangeHandler
       * @methodOf decipher.history.object:Watch
       * @method
       * @param {string} name Unique name of handler
       * @param {Function} fn Function to execute upon change
       * @param {object} resolve Mapping of function parameters to values
       * @description
       * Adds a rollback handler function with name `name` to be executed
       * whenever the batch tied to this watch is rolled back.
       * @returns {Watch} This {@link decipher.history.object:Watch Watch instance}
       */
      Watch.prototype.addRollbackHandler =
      function addRollbackHandler(name, fn, resolve) {
        return this._addHandler('_rollbackHandlers', name, fn, resolve);
      };

      /**
       * @ngdoc function
       * @name decipher.history.object:Watch#removeRevertHandler
       * @methodOf decipher.history.object:Watch
       * @method
       * @param {string} name Name of handler to remove
       * @returns {Watch} This {@link decipher.history.object:Watch Watch instance}
       * @description
       * Removes a revert handler with name `name`.
       */
      Watch.prototype.removeRevertHandler = function removeRevertHandler(name) {
        return this._removeHandler('_revertHandlers', name);
      };
      /**
       * @ngdoc function
       * @name decipher.history.object:Watch#removeChangeHandler
       * @methodOf decipher.history.object:Watch
       * @method
       * @param {string} name Name of handler to remove
       * @returns {Watch} This {@link decipher.history.object:Watch Watch instance}
       * @description
       * Removes a change handler with name `name`.
       */
      Watch.prototype.removeChangeHandler = function removeChangeHandler(name) {
        return this._removeHandler('_changeHandlers', name);
      };
      /**
       * @ngdoc function
       * @name decipher.history.object:Watch#removeUndoHandler
       * @methodOf decipher.history.object:Watch
       * @method
       * @param {string} name Name of handler to remove
       * @returns {Watch} This {@link decipher.history.object:Watch Watch instance}
       * @description
       * Removes a undo handler with name `name`.
       */
      Watch.prototype.removeUndoHandler = function removeUndoHandler(name) {
        return this._removeHandler('_undoHandlers', name);
      };

      /**
       * @ngdoc function
       * @name decipher.history.object:Watch#removeRollbackHandler
       * @methodOf decipher.history.object:Watch
       * @method
       * @param {string} name Name of handler to remove
       * @returns {Watch} This {@link decipher.history.object:Watch Watch instance}
       * @description
       * Removes a rollback handler with name `name`.
       */
      Watch.prototype.removeRollbackHandler =
      function removeRollbackHandler(name) {
        return this._removeHandler('_rollbackHandlers', name);
      };

      /**
       * @ngdoc function
       * @name decipher.history.object:Watch#removeRedoHandler
       * @methodOf decipher.history.object:Watch
       * @method
       * @param {string} name Name of handler to remove
       * @returns {Watch} This {@link decipher.history.object:Watch Watch instance}
       * @description
       * Removes a redo handler with name `name`.
       */
      Watch.prototype.removeRedoHandler =
      function removeRedoHandler(name) {
        return this._removeHandler('_redoHandlers', name);
      };

      /**
       * Fires all handlers for a particular type, optionally w/ a scope.
       * @param {string} where Watch type
       * @param {string} exp Expression
       * @param {Scope} [scope] Optional Scope
       * @private
       */
      Watch.prototype._fireHandlers =
      function _fireHandlers(where, exp, scope) {
        var hasScope = angular.isDefined(scope);
        angular.forEach(this[where], function (handler) {
          var locals = {};
          if (angular.isDefined(scope)) {
            locals.$locals = scope;
          }
          if (angular.isDefined(exp)) {
            locals.$expression = exp;
          }
          angular.forEach(handler.resolve, function (value, key) {
            if (hasScope) {
              locals[key] = $parse(value)(scope);
            } else {
              locals[key] = value;
            }
          });
          $injector.invoke(handler.fn, scope || this, locals);
        });
      };

      /**
       * Fires the change handlers
       * @param {Scope} scope Scope
       * @param {string} exp Expression
       * @private
       */
      Watch.prototype._fireChangeHandlers =
      function _fireChangeHandlers(exp, scope) {
        this._fireHandlers('_changeHandlers', exp, scope);
      };

      /**
       * Fires the undo handlers
       * @param {Scope} scope Scope
       * @param {string} exp Expression
       * @private
       */
      Watch.prototype._fireUndoHandlers =
      function _fireUndoHandlers(exp, scope) {
        this._fireHandlers('_undoHandlers', exp, scope);
      };

      /**
       * Fires the redo handlers
       * @param {Scope} scope Scope
       * @param {string} exp Expression
       * @private
       */
      Watch.prototype._fireRedoHandlers =
      function _fireRedoHandlers(exp, scope) {
        this._fireHandlers('_redoHandlers', exp, scope);
      };

      /**
       * Fires the revert handlers
       * @param {Scope} scope Scope
       * @param {string} exp Expression
       * @private
       */
      Watch.prototype._fireRevertHandlers =
      function _fireRevertHandlers(exp, scope) {
        this._fireHandlers('_revertHandlers', exp, scope);
      };

      /**
       * Fires the rollback handlers (note lack of scope and expression)
       * @private
       */
      Watch.prototype._fireRollbackHandlers =
      function _fireRollbackHandlers() {
        this._fireHandlers('_rollbackHandlers');
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

      /**
       * When an expression changes, store the information about it
       * and increment a pointer.
       * @param {string|Function} exp Expression
       * @param {string} id Scope $id
       * @param {Scope} locals AngularJS scope
       * @param {boolean} pass Whether or not to pass on the first call
       * @param {string} description AngularJS string to interpolate
       * @return {Function} Watch function
       * @private
       */
      this._archive = function (exp, id, locals, pass, description) {
        return function (newVal, oldVal) {
          var watchId;
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
          pointers[id][exp] = history[id][exp].length - 1;
          if (pointers[id][exp] > 0) {
            watchId = locals.$$deepWatchId ? locals.$parent.$id : locals.$id;
            if (!batching && angular.isDefined(watchObjs[watchId]) &&
                angular.isDefined(watchObjs[watchId][exp])) {
              watchObjs[watchId][exp]._fireChangeHandlers(exp, locals);
            }
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
       * @ngdoc function
       * @name decipher.history.service:History#watch
       * @method
       * @methodOf decipher.history.service:History
       * @description
       * Register some expression(s) for watching.
       * @param {(string|string[])} exps Array of expressions or one expression as a string
       * @param {Scope=} scope Scope; defaults to `$rootScope`
       * @param {string=} description Description of this change
       * @param {Object=} lazyOptions Options for lazy loading.  Only valid
       * property is `timeout` at this point
       * @returns {Watch} {@link decipher.history.object:Watch Watch instance}
       *
       * @example
       * <example module="decipher.history">
       <file name="script.js">

       angular.module('decipher.history')
       .run(function(History, $rootScope) {
            $rootScope.foo = 'foo';

            $rootScope.$on('History.archived', function(evt, data) {
              $rootScope.message = data.description;
            });

            History.watch('foo', $rootScope, 'you changed the foo');
        });
       </file>
       <file name="index.html">
       <input type="text" ng-model="foo"/> {{foo}}<br/>
       <span ng-show="message">{{message}}</span><br/>
       </file>
       </example>
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
            throw 'expression "' + exp +
                  '" is not an assignable expression';
          }

          // blast any old watches
          if (angular.isFunction(watches[id][exp])) {
            watches[id][exp]();
          }

          if (!descriptions[id]) {
            descriptions[id] = {};
          }
          descriptions[id][exp] = $interpolate(description)(scope);

          this._watch(exp, scope, false, lazyOptions);

        }
        if (angular.isUndefined(watchObjs[id])) {
          watchObjs[id] = {};
        }
        return watchObjs[id][exp] = new Watch();
      };

      /**
       * @ngdoc function
       * @name decipher.history.service:History#deepWatch
       * @method
       * @methodOf decipher.history.service:History
       * @description
       * Allows you to watch an entire array/object full of objects, but only watch
       * a certain property of each object.
       *
       * @example
       * <example module="decipher.history">
       <file name="script.js">
       angular.module('decipher.history')
       .run(function(History, $rootScope) {
            var exp, locals;

            $rootScope.foos = [
              {id: 1, name: 'herp'},
              {id: 2, name: 'derp'}
            ];

            $rootScope.$on('History.archived', function(evt, data) {
              $rootScope.message = data.description;
              exp = data.expression;
              locals = data.locals;
            })

            History.deepWatch('foo.name for foo in foos', $rootScope,
              'Changed {{foo.id}} to name "{{foo.name}}"')
              .addChangeHandler('myChangeHandler', function($expression,
                  $locals, foo) {
                console.log(foo);
                console.log("(totally hit the server and update the model)");
                $rootScope.undo = function() {
                  History.undo($expression, $locals);
                };
                $rootScope.canUndo = function() {
                  return History.canUndo($expression, $locals);
                };
              }, {foo: 'foo'});
          });
       </file>
       <file name="index.html">
       <input type="text" ng-model="foos[0].name"/> {{foos[0].name}}<br/>
       <span ng-show="message">{{message}}</span><br/>
       <button ng-disabled="!canUndo()" ng-click="undo()">Undo!</button>
       </file>
       </example>
       * @param {(string|string[])} exp Expression or array of expressions to watch
       * @param {Scope=} scope Scope; defaults to `$rootScope`
       * @param {string=} description Description of this change
       * @param {Object=} lazyOptions Options for lazy loading.  Only valid
       * property is `timeout` at this point
       * @return {Watch} {@link decipher.history.object:Watch Watch instance}
       */
      this.deepWatch =
      function deepWatch(exp, scope, description, lazyOptions) {
        var match,
          targetName,
          valueFn,
          keyName,
          valuesFn,
          values,
          value,
          valueName,
          valuesName,
          _clear = this._clear,
          _archive = this._archive;
        description = description || '';
        if (!(match = exp.match(DEEPWATCH_EXP))) {
          throw 'expected expression in form of "_select_ for (_key_,)? _value_ in _collection_" but got "' +
                exp + '"';
        }
        targetName = match[1];
        valueName = match[4] || match[2];
        valueFn = $parse(valueName);
        keyName = match[3];
        valuesName = match[5];
        valuesFn = $parse(valuesName);
        values = valuesFn(scope);

        if (angular.isUndefined(scope.$$deepWatch)) {
          scope.$$deepWatch = {};
        }
        scope.$$deepWatch[exp] = ++deepWatchId;

        angular.forEach(values, function (v, k) {
          var locals = scope.$new(),
            id = locals.$id;
          locals.$$deepWatchId = scope.$$deepWatch[exp];
          locals.$$deepWatchTargetName = targetName;
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
            watches[id][targetName] =
            locals.$watch(lazyWatch(locals, targetName,
              lazyOptions.timeout || 500),
              _archive(targetName, id, locals, false, description));
            lazyWatches[id][exp] = true;
          }
          else {
            watches[id][targetName] = locals.$watch(targetName,
              _archive(targetName, id, locals, false, description));
            lazyWatches[id][exp] = false;
          }

          locals.$on('$destroy', function () {
            _clear(locals);
          });

        });

        if (angular.isUndefined(watchObjs[scope.$id])) {
          watchObjs[scope.$id] = {};
        }

        return watchObjs[scope.$id][targetName] = new Watch();
      };

      /**
       * Clears a bunch of information for a scope and optionally an array of expressions.
       * Lacking an expression, this will eliminate an entire scopesworth of data.
       * It will recognize deep watches and clear them out completely.
       * @param {Scope} scope Scope obj
       * @param {(string|string[])} exps Expression or array of expressions
       * @private
       */
      this._clear = function _clear(scope, exps) {
        var id = scope.$id,
          i,
          exp,
          childHead,
          nextSibling,
          dwid;

        function clear(id, exp) {
          angular.forEach(watches[id], function (watch) {
            if (angular.isFunction(watch)) {
              watch();
            }
          });
          if (angular.isDefined(watches[id]) &&
              angular.isFunction(watches[id][exp])) {
            watches[id][exp]();
          }
          if (angular.isDefined(watches[id])) {
            delete watches[id][exp];
          }
          if (angular.isDefined(history[id])) {
            delete history[id][exp];
          }
          if (angular.isDefined(pointers[id])) {
            delete pointers[id][exp];
          }
          if (angular.isDefined(lazyWatches[id])) {
            delete lazyWatches[id][exp];
          }
        }

        exps = angular.isArray(exps) ? exps : Object.keys(watches[id]);

        i = exps.length;
        while (i--) {
          exp = exps[i];
          clear(id, exp);
          if (angular.isDefined(scope.$$deepWatch)) {
            // find children.
            dwid = scope.$$deepWatch[exp];
            childHead = scope.$$childHead;
            if (childHead) {
              if (childHead.$$deepWatchId === dwid) {
                clear(childHead.$id, childHead.$$deepWatchTargetName);
              }
              nextSibling = childHead;
              while (nextSibling = nextSibling.$$nextSibling) {
                if (nextSibling.$$deepWatchId === dwid) {
                  clear(nextSibling.$id, childHead.$$deepWatchTargetName);
                }
              }
            }
          }
        }
      };


      /**
       * @ngdoc function
       * @name decipher.history.service:History#forget
       * @method
       * @methodOf decipher.history.service:History
       * @description
       * Unregister some watched expression(s).
       * @param {(string|string[])} exps Array of expressions or one expression as a string
       * @param {Scope=} scope Scope object; defaults to $rootScope
       */
      this.forget = function forget(exps, scope) {
        scope = scope || $rootScope;
        if (!angular.isArray(exps) && angular.isString(exps)) {
          exps = [exps];
        }
        this._clear(scope, exps);
      };

      /**
       * Internal function to change some value in the stack to another.
       * Kills the watch and then calls `_watch()` to restore it.
       * @param {Scope} scope Scope object
       * @param {string} exp AngularJS expression
       * @param {array} stack History stack; see `History.history`
       * @param {number} pointer Pointer
       * @returns {{oldValue: {*}, newValue: {*}}} The old value and the new value
       * @private
       */
      this._do = function _do(scope, exp, stack, pointer) {
        var model,
          oldValue,
          id = scope.$id;
        if (angular.isFunction(watches[id][exp])) {
          watches[id][exp]();
          delete watches[id][exp];
        }
        model = $parse(exp);
        oldValue = model(scope);
        model.assign(scope, stack[pointer]);
        this._watch(exp, scope, true);
        return {
          oldValue: oldValue,
          newValue: model(scope)
        };
      };

      /**
       * @ngdoc function
       * @name decipher.history.service:History#undo
       * @method
       * @methodOf decipher.history.service:History
       * @description
       * Undos an expression to last known value.
       * @param {string} exp Expression to undo
       * @param {Scope=} scope Scope; defaults to `$rootScope`
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
          pointer,
          watchId;

        if (angular.isUndefined(scopeHistory)) {
          throw 'could not find history for scope ' + id;
        }

        stack = scopeHistory[exp];
        if (angular.isUndefined(stack)) {
          throw 'could not find history in scope "' + id +
                ' against expression "' + exp + '"';
        }
        pointer = --pointers[id][exp];
        if (pointer < 0) {
          $log.warn('attempt to undo past history');
          pointers[id][exp]++;
          return;
        }
        values = this._do(scope, exp, stack, pointer);

        watchId = scope.$$deepWatchId ? scope.$parent.$id : scope.$id;
        if (angular.isDefined(watchObjs[watchId]) &&
            angular.isDefined(watchObjs[watchId][exp])) {
          watchObjs[watchId][exp]._fireUndoHandlers(exp, scope);
        }

        $rootScope.$broadcast('History.undone', {
          expression: exp,
          newValue: values.newValue,
          oldValue: values.oldValue,
          description: descriptions[id][exp],
          scope: scope
        });
      };

      /**
       * Actually issues the appropriate scope.$watch
       * @param {string} exp Expression
       * @param {Scope=} scope Scope; defaults to $rootScope
       * @param {boolean=} pass Whether or not to skip the first watch execution.  Defaults to false
       * @param {Object} lazyOptions Options to send the lazy module
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
            this._archive(exp, id, scope, pass), true);
          lazyWatches[id][exp] = true;
        }
        else {
          watches[id][exp] =
          scope.$watch(exp, this._archive(exp, id, scope, pass), true);
          lazyWatches[id][exp] = false;
        }

      };

      /**
       * @ngdoc function
       * @name decipher.history.service:History#redo
       * @method
       * @methodOf decipher.history.service:History
       * @description
       * Redoes (?) the last undo.
       * @param {string} exp Expression to redo
       * @param {Scope=} scope Scope; defaults to `$rootScope`
       */
      this.redo = function redo(exp, scope) {
        scope = scope || $rootScope;
        var id = scope.$id,
          stack = history[id][exp],
          values,
          pointer,
          watchId;
        if (angular.isUndefined(stack)) {
          throw 'could not find history in scope "' + id +
                ' against expression "' + exp + '"';
        }
        pointer = ++pointers[id][exp];
        if (pointer === stack.length) {
          $log.warn('attempt to redo past history');
          pointers[id][exp]--;
          return;
        }

        values = this._do(scope, exp, stack, pointer);

        watchId = scope.$$deepWatchId ? scope.$parent.$id : scope.$id;
        if (angular.isDefined(watchObjs[watchId]) &&
            angular.isDefined(watchObjs[watchId][exp])) {
          watchObjs[watchId][exp]._fireRedoHandlers(exp, scope);
        }

        $rootScope.$broadcast('History.redone', {
          expression: exp,
          oldValue: angular.copy(values.newValue),
          newValue: angular.copy(values.oldValue),
          description: descriptions[id][exp],
          scope: scope
        });

      };

      /**
       * @ngdoc function
       * @name decipher.history.service:History#canUndo
       * @method
       * @methodOf decipher.history.service:History
       * @description
       * Whether or not we have accumulated any history for a particular expression.
       * @param {string} exp Expression
       * @param {Scope=} scope Scope; defaults to $rootScope
       * @return {boolean} Whether or not you can issue an `undo()`
       * @example
       * <example module="decipher.history">
       <file name="script.js">
       angular.module('decipher.history').run(function(History, $rootScope) {
              $rootScope.foo = 'bar';
              History.watch('foo');
              $rootScope.canUndo = History.canUndo;
            });
       </file>
       <file name="index.html">
       <input type="text" ng-model="foo"/>  Can undo?  {{canUndo('foo')}}
       </file>
       </example>
       */
      this.canUndo = function canUndo(exp, scope) {
        var id;
        scope = scope || $rootScope;
        id = scope.$id;
        return angular.isDefined(pointers[id]) &&
               angular.isDefined(pointers[id][exp]) &&
               pointers[id][exp] > 0;
      };

      /**
       * @ngdoc function
       * @name decipher.history.service:History#canRedo
       * @method
       * @methodOf decipher.history.service:History
       * @description
       * Whether or not we can redo an expression's value.
       * @param {string} exp Expression
       * @param {Scope=} scope Scope; defaults to $rootScope
       * @return {Boolean} Whether or not you can issue a `redo()`
       * @example
       * <example module="decipher.history">
       <file name="script.js">
       angular.module('decipher.history').run(function(History, $rootScope) {
              $rootScope.foo = 'bar';
              History.watch('foo');
              $rootScope.canRedo = History.canRedo;
              $rootScope.canUndo = History.canUndo;
              $rootScope.undo = History.undo;
            });
       </file>
       <file name="index.html">
       <input type="text" ng-model="foo"/> <br/>
       <button ng-show="canUndo('foo')" ng-click="undo('foo')">Undo</button><br/>
       Can redo?  {{canRedo('foo')}}
       </file>
       </example>
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
       * @ngdoc function
       * @method
       * @methodOf decipher.history.service:History
       * @name decipher.history.service:History#revert
       * @description
       * Reverts to earliest known value of some expression, or at a particular
       * pointer if you please.
       * @param {string} exp Expression
       * @param {Scope=} scope Scope; defaults to $rootScope
       * @param {number=} pointer Optional; defaults to 0
       */
      this.revert = function (exp, scope, pointer) {
        scope = scope || $rootScope;
        pointer = pointer || 0;
        var id = scope.$id,
          stack = history[id][exp],
          values,
          watchId;
        if (angular.isUndefined(stack)) {
          $log.warn('nothing to revert');
          return;
        }
        values = this._do(scope, exp, stack, pointer);

        // wait; what is this?
        history[scope.$id][exp].splice();
        pointers[scope.$id][exp] = pointer;

        watchId = scope.$$deepWatchId ? scope.$parent.$id : scope.$id;
        if (angular.isDefined(watchObjs[watchId]) &&
            angular.isDefined(watchObjs[watchId][exp])) {
          watchObjs[watchId][exp]._fireChangeHandlers(exp, scope);
        }

        $rootScope.$broadcast('History.reverted', {
          expression: exp,
          oldValue: angular.copy(values.newValue),
          newValue: angular.copy(values.oldValue),
          description: descriptions[id][exp],
          scope: scope,
          pointer: pointer
        });
      };

      /**
       * @ngdoc function
       * @name decipher.history.service:History#batch
       * @method
       * @methodOf decipher.history.service:History
       * @description
       * Executes a function within a batch context which can then be rolled back.
       * @param {function} fn Function to execute
       * @param {Scope=} scope Scope object; defaults to `$rootScope`
       * @param {string=} description Description of this change
       * @returns {Watch} {@link decipher.history.object:Watch Watch instance}
       * @example
       <example module="decipher.history">
       <file name="script.js">
       angular.module('decipher.history').run(function(History, $rootScope) {
              var t;

              $rootScope.herp = 'derp';
              $rootScope.bar = 'baz';
              $rootScope.frick = 'frack';

              $rootScope.$on('History.batchEnded', function(evt, data) {
                t = data.transaction;
              });

              History.watch('herp');
              History.watch('bar');
              History.watch('frick');

              $rootScope.batch = function() {
                History.batch(function() {
                  $rootScope.herp = 'derp2';
                  $rootScope.bar = 'baz2';
                  $rootScope.frick = 'frack2';
                })
                  .addRollbackHandler('myRollbackHandler', function() {
                    $rootScope.message = 'rolled a bunch of stuff back';
                  });
                $rootScope.message = "batch complete";
              };

              $rootScope.rollback = function() {
                if (angular.isDefined(t)) {
                  History.rollback(t);
                }
              };
            });
       </file>
       <file name="index.html">
       <ul>
       <li>herp: {{herp}}</li>
       <li>bar: {{bar}}</li>
       <li>frick: {{frick}}</li>
       </ul>
       <button ng-click="batch()">Batch</button>
       <button ng-click="rollback()">Rollback</button><br/>
       {{message}}
       </file>
       </example>
       */
      this.batch = function batch(fn, scope, description) {
        var _clear = this._clear,
          listener,
          child;
        scope = scope || $rootScope;
        if (!angular.isFunction(fn)) {
          throw 'transaction requires a function';
        }

        child = scope.$new();
        child.$on('$destroy', function () {
          _clear(child);
        });

        listener = scope.$on('History.archived', function (evt, data) {
          var deepChild,
            exp = data.expression,
            id;
          if (data.locals.$id !== child.$id) {
            deepChild = child.$new();
            deepChild.$on('$destroy', function () {
              _clear(deepChild);
            });
            deepChild.$$locals = data.locals;
            id = deepChild.$id;
            history[id] = {};
            pointers[id] = {};
            history[id][exp] =
            angular.copy(history[data.locals.$id][exp]);
            pointers[id][exp] = pointers[data.locals.$id][exp] - 1;
          }
        });

        $rootScope.$broadcast('History.batchBegan', {
          transaction: child,
          description: description
        });

        // we need to put this into a timeout and apply manually
        // since it's not clear when the watchers will get fired,
        // and we must ensure that any existing watchers on the archived
        // event can be skipped before the batchEnd occurs.
        batching = true;
        $timeout(function () {
          fn(child);
          scope.$apply();
        }).then(function () {
            listener();
            batching = false;
            $rootScope.$broadcast('History.batchEnded', {
              transaction: child,
              description: description
            });
          });

        return watchObjs[child.$id] = new Watch(child);
      };

      /**
       * @ngdoc function
       * @name decipher.history.service:History#rollback
       * @method
       * @methodOf decipher.history.service:History
       * @description
       * Rolls a transaction back that was executed via {@link decipher.history.service:History#batch batch()}.
       *
       * For an example, see {@link decipher.history.service:History#batch batch()}.
       * @param {Scope} t Scope object in which the transaction was executed.
       */
      this.rollback = function rollback(t) {

        var _do = angular.bind(this, this._do),
          parent = t.$parent,
          packets = {},
          childHead,
          childHeadLocals,
          nextSibling,
          nextSiblingLocals;
        if (!t || !angular.isObject(t)) {
          throw 'must pass a scope to rollback'
        }

        function _rollback(scope, comparisonScope) {
          var id = scope.$id,
            comparisonScopeId = comparisonScope.$id,
            stack = history[id],
            pointer,
            descs,
            exp,
            values,
            exps,
            rolledback,
            i;
          if (stack) {
            exps = Object.keys(stack);
            i = exps.length;
          } else {
            // might not actually have history, it's ok
            return;
          }
          while (i--) {
            exp = exps[i];
            values = [];
            descs = [];
            pointer = pointers[comparisonScopeId][exp];
            rolledback = false;
            while (pointer > pointers[id][exp]) {
              pointer--;
              values.push(_do(comparisonScope,
                exp, history[comparisonScopeId][exp], pointer));
              pointers[comparisonScopeId][exp] = pointer;
              descs.push(descriptions[comparisonScopeId][exp]);
              // throw this off the history stack so
              // we don't end up with it in the stack while we
              // do normal undo() calls later against the same
              // expression and scope
              history[comparisonScopeId][exp].pop();
              rolledback = true;
            }
            if (rolledback) {
              packets[exp] = {
                values: values,
                scope: scope,
                comparisonScope: comparisonScope,
                descriptions: descs
              };
            }
          }
        }

        if (angular.isDefined(parent) &&
            angular.isDefined(history[parent.$id])) {
          _rollback(t, parent);
        }
        childHead = t.$$childHead;
        if (childHead) {
          childHeadLocals = childHead.$$locals;
          if (childHeadLocals) {
            _rollback(childHead, childHeadLocals);
          }
          nextSibling = childHead;
          while (nextSibling = nextSibling.$$nextSibling) {
            nextSiblingLocals = nextSibling.$$locals;
            if (nextSiblingLocals) {
              _rollback(nextSibling, nextSiblingLocals);
            }
          }
        }

        watchObjs[t.$id]._fireRollbackHandlers();

        $rootScope.$broadcast('History.rolledback', packets);

      };
      /**
       * @ngdoc property
       * @name decipher.history.service:History#history
       * @propertyOf decipher.history.service:History
       * @description
       * The complete history stack, keyed by Scope `$id` and then expression.
       * @type {{}}
       */
      this.history = history;

      /**
       * @ngdoc property
       * @name decipher.history.service:History#descriptions
       * @propertyOf decipher.history.service:History
       * @description
       * The complete map of change descriptions, keyed by Scope `$id` and then expression.
       * @type {{}}
       */
      this.descriptions = descriptions;

      /**
       * @ngdoc property
       * @name decipher.history.service:History#pointers
       * @propertyOf decipher.history.service:History
       * @description
       * The complete pointer map, keyed by Scope `$id` and then expression.
       * @type {{}}
       */
      this.pointers = pointers;

      /**
       * @ngdoc property
       * @name decipher.history.service:History#watches
       * @propertyOf decipher.history.service:History
       * @description
       * The complete index of all AngularJS `$watch`es, keyed by Scope `$id` and then expression.
       * @type {{}}
       */
      this.watches = watches;

      /**
       * @ngdoc property
       * @name decipher.history.service:History#lazyWatches
       * @propertyOf decipher.history.service:History
       * @description
       * The complete index of all AngularJS `$watch`es designated to be "lazy", keyed by Scope `$id` and then expression.
       * @type {{}}
       */
      this.lazyWatches = lazyWatches;

      /**
       * @ngdoc property
       * @name decipher.history.service:History#watchObjs
       * @propertyOf decipher.history.service:History
       * @description
       * The complete index of all {@link decipher.history.object:Watch Watch} objects registered, keyed by Scope `$id` and then (optionally) expression.
       * @type {{}}
       */
      this.watchObjs = watchObjs;
    });
})();
