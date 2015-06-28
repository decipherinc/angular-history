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
    lazyBindFound = false,
    isDefined = angular.isDefined,
    isUndefined = angular.isUndefined,
    isFunction = angular.isFunction,
    isArray = angular.isArray,
    isString = angular.isString,
    isObject = angular.isObject,
    forEach = angular.forEach,
    copy = angular.copy,
    bind = angular.bind;

  /**
   * Polyfill for Object.keys
   *
   * @see: https://developer.mozilla.org/en-US/docs/JavaScript/Reference/Global_Objects/Object/keys
   */
  if (!Object.keys) {
    Object.keys = (function () {
      var hasOwnProperty = Object.prototype.hasOwnProperty,
        hasDontEnumBug = !({toString: null}).propertyIsEnumerable('toString'),
        dontEnums = [
          'toString',
          'toLocaleString',
          'valueOf',
          'hasOwnProperty',
          'isPrototypeOf',
          'propertyIsEnumerable',
          'constructor'
        ],
        dontEnumsLength = dontEnums.length;

      return function (obj) {
        if (typeof obj !== 'object' && typeof obj !== 'function' ||
          obj === null) {
          throw new TypeError('Object.keys called on non-object');
        }

        var result = [];

        for (var prop in obj) {
          if (hasOwnProperty.call(obj, prop)) {
            result.push(prop);
          }
        }

        if (hasDontEnumBug) {
          for (var i = 0; i < dontEnumsLength; i++) {
            if (hasOwnProperty.call(obj,
              dontEnums[i])) {
              result.push(dontEnums[i]);
            }
          }
        }
        return result;
      };
    })();
  }

  // stub out lazyBind if we don't have it.
  try {
    angular.module('lazyBind');
    lazyBindFound = true;
  }
  catch (e) {
    angular.module('lazyBind', []).factory('$lazyBind', function() {return angular.noop});
  }

  /**
   * @ngdoc service
   * @name decipher.history.service:History
   * @description
   * Provides an API for keeping a history of model values.
   */
  angular.module('decipher.history', ['lazyBind']).service('History',
    [
      '$parse',
      '$rootScope',
      '$interpolate',
      '$lazyBind',
      '$timeout',
      '$log',
      '$injector',
    function ($parse, $rootScope, $interpolate, $lazyBind, $timeout, $log,
      $injector) {
      var service = this,
        history = {},
        pointers = {},
        watches = {},
        watchObjs = {},
        lazyWatches = {},
        descriptions = {},
      // TODO: async safe?
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
       *
       * @todo ability to remove all handlers at once, or all handlers of a certain type
       */
      var Watch = function Watch(exp, scope) {
        this.exp = exp;
        this.scope = scope || $rootScope;

        this.$handlers = {
          $change : {},
          $undo : {},
          $rollback : {},
          $redo : {},
          $revert : {},
        };

        this.$ignores = {};
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
            throw new Error('invalid parameters to _addHandler()');
          }
          this.$handlers[where][name] = {
            fn: fn,
            resolve: resolve || {}
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
          throw new Error('invalid parameters to _removeHandler()');
        }
        delete this.$handlers[where][name];
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
          if (!name || !fn) {
            throw new Error('invalid parameters');
          }
          return this._addHandler('$change', name, fn, resolve);
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
          if (!name || !fn) {
            throw new Error('invalid parameters');
          }
          return this._addHandler('$undo', name, fn, resolve);
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
          if (!name || !fn) {
            throw new Error('invalid parameters');
          }
          return this._addHandler('$redo', name, fn, resolve);
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
          if (!name || !fn) {
            throw new Error('invalid parameters');
          }
          return this._addHandler('$revert', name, fn, resolve);
        };
      /**
       * @ngdoc function
       * @name decipher.history.object:Watch#addRollbackHandler
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
          if (!name || !fn) {
            throw new Error('invalid parameters');
          }
          return this._addHandler('$rollback', name, fn, resolve);
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
        if (!name) {
          throw new Error('invalid parameters');
        }
        return this._removeHandler('$revert', name);
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
        if (!name) {
          throw new Error('invalid parameters');
        }
        return this._removeHandler('$change', name);
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
        if (!name) {
          throw new Error('invalid parameters');
        }
        return this._removeHandler('$undo', name);
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
          return this._removeHandler('$rollback', name);
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
          if (!name) {
            throw new Error('invalid parameters');
          }
          return this._removeHandler('$redo', name);
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
          var hasScope = isDefined(scope),
            localScope = this.scope, that = this;
          forEach(this.$handlers[where], function (handler) {
            var locals = {
              $locals: localScope
            };
            if (isDefined(scope)) {
              locals.$locals = scope;
            }
            if (isDefined(exp)) {
              locals.$expression = exp;
            }
            forEach(handler.resolve, function (value, key) {
              if (hasScope) {
                locals[key] = $parse(value)(scope);
              } else {
                locals[key] = value;
              }
            });
            $injector.invoke(handler.fn, scope || that, locals);
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
          this._fireHandlers('$change', exp, scope);
        };

      /**
       * Fires the undo handlers
       * @param {Scope} scope Scope
       * @param {string} exp Expression
       * @private
       */
      Watch.prototype._fireUndoHandlers =
        function _fireUndoHandlers(exp, scope) {
          this._fireHandlers('$undo', exp, scope);
        };

      /**
       * Fires the redo handlers
       * @param {Scope} scope Scope
       * @param {string} exp Expression
       * @private
       */
      Watch.prototype._fireRedoHandlers =
        function _fireRedoHandlers(exp, scope) {
          this._fireHandlers('$redo', exp, scope);
        };

      /**
       * Fires the revert handlers
       * @param {Scope} scope Scope
       * @param {string} exp Expression
       * @private
       */
      Watch.prototype._fireRevertHandlers =
        function _fireRevertHandlers(exp, scope) {
          this._fireHandlers('$revert', exp, scope);
        };

      /**
       * Fires the rollback handlers (note lack of scope and expression)
       * @private
       */
      Watch.prototype._fireRollbackHandlers =
        function _fireRollbackHandlers() {
          this._fireHandlers('$rollback');
        };

      /**
       * Decline to broadcast an event for this Watch.
       * @param {string} eventName Name of event to avoid.  i.e. "History.archived"
       * @param {Function=} callback Optional callback
       * @param {Object=} resolve Optional mapping of parameters to invoke
       * the callback with.
       * @returns {Watch} this Watch object
       */
      Watch.prototype.ignoreEvent =
        function ignoreEvent(eventName, callback, resolve) {
          // special case; we cannot ignore History.archived within a Watch obj
          // created from a batch.  there may be a way around this.
          if (this.exp === null && eventName === 'History.archived') {
            $log.warn('cannot ignore History.archived event for batch');
            return this;
          }
          resolve = resolve || {};
          if (isFunction(callback)) {
            this.$ignores[eventName] = {
              callback: callback,
              resolve: resolve
            };
          } else if (isDefined(callback)) {
            this.$ignores[eventName] = {
              callback: function cb() {
                return callback;
              },
              resolve: resolve
            };
          }
          return this;
        };

      /**
       * Broadcasts an event, taking ignored events into account.
       * @param {string} eventName Event to broadcast
       * @param {*} data Some data to pass
       * @private
       */
      Watch.prototype._broadcast = function _broadcast(eventName, data) {
        var ignore = this.$ignores[eventName];
        if (!ignore ||
          (isFunction(ignore.callback) &&
            !$injector.invoke(ignore.callback, this.scope, angular.extend(ignore.resolve, {$data: data})))) {
          $rootScope.$broadcast(eventName, data);
        }
      };

      /**
       * Undoes last change against this watch object's target.
       */
      Watch.prototype.undo = function undo() {
        if (this.exp === null) {
          $log.warn("attempt to undo a batch; use rollback() instead");
          return;
        }
        service.undo(this.exp, this.scope);
      };

      /**
       * Redoes last undo against this watch object's target.
       */
      Watch.prototype.redo = function redo() {
        if (this.exp === null) {
          $log.warn("attempt to redo a batch; just execute the batch callback again");
        }
        service.redo(this.exp, this.scope);
      };

      /**
       * Reverts this target's watch object.
       * @param {number=0} pointer Pointer to revert to
       */
      Watch.prototype.revert = function revert(pointer) {
        if (this.exp === null) {
          $log.warn("attempt to revert a batch; use rollback() instead");
        }
        service.revert(this.exp, this.scope, pointer);
      };

      /**
       * Whether or not you may undo this watch object's target
       * @returns {boolean}
       */
      Watch.prototype.canUndo = function canUndo() {
        return this.exp === null ? false :
               service.canUndo(this.exp, this.scope);
      };

      /**
       * Whether or not you may redo this watch object's target
       * @returns {boolean}
       */
      Watch.prototype.canRedo = function canRedo() {
        return this.exp === null ? false :
               service.canRedo(this.exp, this.scope);
      };

      /**
       * Evaluates an expression on the scope lazily.  That means it will return
       * a new value every DEFAULT_TIMEOUT ms at maximum, even if you change it between
       * now and then.  This allows us to $broadcast at an interval instead of after
       * every scope change.
       * @param {Object} scope AngularJS Scope
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
       * Initializes object stores for a Scope id
       * @param {string} id Sccope id
       * @private
       */
      this._initStores = function _initStores(id) {
        if (isUndefined(watches[id])) {
          watches[id] = {};
        }
        if (isUndefined(lazyWatches[id])) {
          lazyWatches[id] = {};
        }
        if (isUndefined(descriptions[id])) {
          descriptions[id] = {};
        }
        if (isUndefined(history[id])) {
          history[id] = {};
        }
        if (isUndefined(watchObjs[id])) {
          watchObjs[id] = {};
        }
        if (isUndefined(pointers[id])) {
          pointers[id] = {};
        }
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
        var _initStores = this._initStores;
        return function (newVal, oldVal) {
          var watchObj;
          _initStores(id);
          if (description) {
            descriptions[id][exp] = $interpolate(description)(locals);
          }
          if (pass) {
            pass = false;
            return;
          }
          if (isUndefined(history[id][exp])) {
            history[id][exp] = [];
          }
          if (isUndefined(pointers[id][exp])) {
            pointers[id][exp] = 0;
          }
          history[id][exp].splice(pointers[id][exp] + 1);
          history[id][exp].push(copy(newVal));
          pointers[id][exp] = history[id][exp].length - 1;
          if (pointers[id][exp] > 0 && isDefined(watchObjs[id]) &&
            isDefined(watchObj = watchObjs[id][exp])) {
            if (!batching) {
              watchObj._fireChangeHandlers(exp, locals);
            }
            watchObj._broadcast('History.archived', {
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
       * @param {string|string[]} exps Array of expressions or one expression as a string
       * @param {Scope=} scope Scope; defaults to `$rootScope`
       * @param {string=} description Description of this change
       * @param {Object=} lazyOptions Options for lazy loading.  Only valid
       * property is `timeout` at this point
       * @returns {Watch|Array} {@link decipher.history.object:Watch Watch instance} or array of them
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
        if (isUndefined(exps)) {
          throw new Error('expression required');
        }
        scope = scope || $rootScope;
        description = description || '';
        var i,
          id = scope.$id,
          exp,
          objs = [],
          watchObj,
          model;

        if (!isArray(exps)) {
          exps = [exps];
        }

        this._initStores(id);

        i = exps.length;
        while (i--) {
          exp = exps[i];

          // assert we have an assignable model
          model = $parse(exp);
          if (isUndefined(model.assign)) {
            throw 'expression "' + exp +
              '" is not an assignable expression';
          }

          // blast any old watches
          if (isFunction(watches[id][exp])) {
            watches[id][exp]();
          }

          descriptions[id][exp] = $interpolate(description)(scope);

          this._watch(exp, scope, false, lazyOptions);
          watchObjs[id][exp] = watchObj = new Watch(exp, scope);
          objs.push(watchObj);
        }

        return objs.length > 1 ? objs : objs[0];
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
            value,
            valueName,
            valuesName,
            watchObj,
            id = scope.$id,
            _clear = bind(this, this._clear),
            _initStores = this._initStores,
            _archive = bind(this, this._archive),
            createDeepWatch = function createDeepWatch(targetName, valueName,
              keyName, watchObj) {
              return function (values) {
                forEach(values, function (v, k) {

                  var locals = scope.$new(),
                    id = locals.$id;
                  locals.$$deepWatchId = scope.$$deepWatch[targetName];
                  locals.$$deepWatchTargetName = targetName;
                  locals[valueName] = v;
                  if (keyName) {
                    locals[keyName] = k;
                  }
                  value = valueFn(scope, locals);

                  _initStores(id);

                  descriptions[id][exp] = $interpolate(description)(locals);

                  if (isFunction(watches[id][targetName])) {
                    watches[id][targetName]();
                  }

                  if (lazyBindFound && isObject(lazyOptions)) {
                    watches[id][targetName] =
                      locals.$watch(lazyWatch(locals, targetName,
                        lazyOptions.timeout || 500),
                        _archive(targetName, id, locals, false, description),
                        true);
                    lazyWatches[id][targetName] = true;
                  }
                  else {
                    watches[id][targetName] = locals.$watch(targetName,
                      _archive(targetName, id, locals, false, description),
                      true);
                    lazyWatches[id][targetName] = false;
                  }

                  watchObjs[id][targetName] = watchObj;

                  locals.$on('$destroy', function () {
                    _clear(scope);
                  });

                });

              };
            };

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

          if (isUndefined(scope.$$deepWatch)) {
            scope.$$deepWatch = {};
          }

          // if we already have a deepWatch on this value, we
          // need to kill all the child scopes. because reasons
          if (isDefined(scope.$$deepWatch[targetName])) {
            _clear(scope, targetName);
          }
          scope.$$deepWatch[targetName] = ++deepWatchId;

          _initStores(id);
          watchObjs[id][targetName] = watchObj = new Watch(targetName, scope);

          // TODO: assert this doesn't leak memory like crazy. it might if
          // we remove things from the values context.
          watches[id][targetName] = scope.$watchCollection(valuesName,
            createDeepWatch(targetName, valueName, keyName,
              watchObj));

          return watchObj;
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
          nextSibling,
          exp,
          clear = function clear(id, key) {
            var zap = function zap(what) {
              if (isDefined(what[id][key])) {
                delete what[id][key];
                if (Object.keys(what[id]).length === 0) {
                  delete what[id];
                }
              }
            };

            if (isDefined(watches[id]) &&
              isFunction(watches[id][key])) {
              watches[id][key]();
            }
            if (isDefined(watches[id])) {
              zap(watches);
            }
            if (isDefined(watchObjs[id])) {
              zap(watchObjs);
            }
            if (isDefined(history[id])) {
              zap(history);
            }
            if (isDefined(pointers[id])) {
              zap(pointers);
            }
            if (isDefined(lazyWatches[id])) {
              zap(lazyWatches);
            }
          },

          clearAll = function clearAll(id) {
            forEach(watches[id], function (watch) {
              return isFunction(watch) && watch();
            });
            delete watches[id];
            delete history[id];
            delete pointers[id];
            delete lazyWatches[id];
            delete watchObjs[id];
          };

        if (isString(exps)) {
          exps = [exps];
        }
        else if (isUndefined(exps) && isDefined(watches[id])) {
          exps = Object.keys(watches[id]);
        }

        if (isDefined(exps)) {
          i = exps.length;
          while (i--) {
            exp = exps[i];
            clear(id, exp);
          }
        } else {
          clearAll(id);
        }
        nextSibling = scope.$$childHead;
        while (nextSibling) {
          this._clear(nextSibling, exp);
          nextSibling = nextSibling.$$nextSibling;
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
      this.forget = function forget(scope, exps) {
        scope = scope || $rootScope;
        if (isDefined(exps) && isString(exps)) {
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
        if (isFunction(watches[id][exp])) {
          watches[id][exp]();
          delete watches[id][exp];
        }
        model = $parse(exp);
        oldValue = model(scope);
        // todo: assert there's no bug here with unassignable expressions
        model.assign(scope, copy(stack[pointer]));
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
        if (isUndefined(exp)) {
          throw new Error('expression required');
        }
        var id = scope.$id,
          scopeHistory = history[id],
          stack,
          values,
          pointer,
          watchObj;

        if (isUndefined(scopeHistory)) {
          throw 'could not find history for scope ' + id;
        }

        stack = scopeHistory[exp];
        if (isUndefined(stack)) {
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
        if (isDefined(watchObjs[id]) &&
          isDefined(watchObjs[id][exp])) {
          watchObj = watchObjs[id][exp];
          watchObj._fireUndoHandlers(exp, scope);
          watchObj._broadcast('History.undone', {
            expression: exp,
            newValue: values.newValue,
            oldValue: values.oldValue,
            description: descriptions[id][exp],
            scope: scope
          });
        }
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
        if (lazyBindFound && (isObject(lazyOptions) ||
          (lazyWatches[id] && !!lazyWatches[id][exp]))) {
          watches[id][exp] =
            scope.$watch(lazyWatch(scope, exp, lazyOptions.timeout),
              bind(this, this._archive(exp, id, scope, pass)), true);
          lazyWatches[id][exp] = true;
        }
        else {
          watches[id][exp] =
            scope.$watch(exp, bind(this, this._archive(exp, id, scope, pass)),
              true);
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
          watchObj;

        if (isUndefined(stack)) {
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

        if (isDefined(watchObjs[id]) &&
          isDefined(watchObjs[id][exp])) {
          watchObj = watchObjs[id][exp];
          watchObj._fireRedoHandlers(exp, scope);
          watchObj._broadcast('History.redone', {
            expression: exp,
            oldValue: copy(values.newValue),
            newValue: copy(values.oldValue),
            description: descriptions[id][exp],
            scope: scope
          });
        }
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
        return isDefined(pointers[id]) &&
          isDefined(pointers[id][exp]) &&
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
        return isDefined(pointers[id]) &&
          isDefined(pointers[id][exp]) &&
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
          watchObj;

        if (isUndefined(stack)) {
          $log.warn('nothing to revert');
          return;
        }
        values = this._do(scope, exp, stack, pointer);

        // wait; what is this?
        history[id][exp].splice();
        pointers[id][exp] = pointer;

        if (isDefined(watchObjs[id]) &&
          isDefined(watchObjs[id][exp])) {
          watchObj = watchObjs[id][exp];
          watchObj._fireRevertHandlers(exp, scope);
          watchObj._broadcast('History.reverted', {
            expression: exp,
            oldValue: copy(values.newValue),
            newValue: copy(values.oldValue),
            description: descriptions[id][exp],
            scope: scope,
            pointer: pointer
          });
        }
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
                if (isDefined(t)) {
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
        var _clear = bind(this, this._clear),
          _initStores = this._initStores,
          listener,
          watchObj,
          child;
        scope = scope || $rootScope;
        if (!isFunction(fn)) {
          throw new Error('transaction requires a function');
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
            _initStores(id);
            history[id][exp] =
              copy(history[data.locals.$id][exp]);
            pointers[id][exp] = pointers[data.locals.$id][exp] - 1;
          }
        });

        watchObjs[child.$id] = watchObj = new Watch(null, child);
        watchObj._broadcast('History.batchBegan', {
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
        })
          .then(function () {
            listener();
            batching = false;
            watchObj._broadcast('History.batchEnded', {
              transaction: child,
              description: description
            });
          });


        return watchObj;
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

        var _do = bind(this, this._do),
          parent = t.$parent,
          packets = {},
          nextSibling,
          watchObj,
          nextSiblingLocals;
        if (!t || !isObject(t)) {
          throw new Error('must pass a scope to rollback');
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

        watchObj = watchObjs[t.$id];

        if (isDefined(parent) &&
          isDefined(history[parent.$id])) {
          _rollback(t, parent);
        }
        nextSibling = t.$$childHead;
        while (nextSibling) {
          nextSiblingLocals = nextSibling.$$locals;
          if (nextSiblingLocals) {
            _rollback(nextSibling, nextSiblingLocals);
          }
          nextSibling = nextSibling.$$nextSibling;
        }
        watchObj._fireRollbackHandlers();
        watchObj._broadcast('History.rolledback', packets);

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

      /**
       * @ngdoc property
       * @name decipher.history.service:History#Watch
       * @propertyOf decipher.history.service:History
       * @description
       * Here's the Watch prototype for you to play with.
       * @type {Watch}
       */
      this.Watch = Watch;
    }]);
})();
