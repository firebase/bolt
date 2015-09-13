/*
 * AST builders for Firebase Rules Language.
 *
 * Copyright 2015 Google Inc. All Rights Reserved.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */
/// <reference path="../types/node.d.ts" />
require('source-map-support').install();

"use strict";

var util = require('./util');

var string = valueGen('String');
var eq = opGen('==');
var nop = opGen('nop', 1);
var boolean = valueGen('Boolean');

module.exports = {
  'variable': variable,
  'nullType': nullType,
  'reference': reference,
  'call': call,
  'snapshotVariable': snapshotVariable,
  'snapshotChild': snapshotChild,
  'snapshotParent': snapshotParent,
  'snapshotValue': snapshotValue,
  'cast': cast,
  'ensureValue': ensureValue,
  'ensureBoolean': ensureBoolean,
  'method': method,

  'number': valueGen('Number'),
  'boolean': boolean,
  'string': string,
  'array': array,

  'neg': opGen('neg', 1),
  'not': opGen('!', 1),
  'mult': opGen('*'),
  'div': opGen('/'),
  'mod': opGen('%'),
  'add': opGen('+'),
  'sub': opGen('-'),
  'lt': opGen('<'),
  'lte': opGen('<='),
  'gt': opGen('>'),
  'gte': opGen('>='),
  'eq': eq,
  'ne': opGen('!='),
  'and': opGen('&&'),
  'or': opGen('||'),
  'ternary': opGen('?:', 3),
  'nop': nop,
  'value': opGen('value', 1),

  'andArray': leftAssociateGen('&&', boolean(true)),
  'orArray': leftAssociateGen('||', boolean(false)),

  'op': op,

  'Symbols': Symbols
};

var errors = {
  typeMismatch: "Unexpected type: ",
};

function variable(name) {
  return { type: 'var', name: name };
}

function nullType() {
  return { type: 'Null' };
}

function reference(base, prop) {
  return {
    type: 'ref',
    base: base,
    accessor: prop
  };
}

function cast(base, valueType) {
  var result = nop(base);
  if (valueType) {
    result.valueType = valueType;
  }
  return result;
}

function call(ref, args) {
  args = args || [];
  return { type: 'call', ref: ref, args: args };
}

function snapshotVariable(name) {
  return cast(variable(name), 'Snapshot');
}

function snapshotChild(base, accessor) {
  if (typeof accessor == 'string') {
    accessor = string(accessor);
  }
  if (base.valueType != 'Snapshot') {
    throw new Error(errors.typeMismatch + "expected Snapshot");
  }
  return cast(call(reference(cast(base), 'child'), [accessor]), 'Snapshot');
}

function snapshotParent(base) {
  if (base.valueType != 'Snapshot') {
    throw new Error(errors.typeMismatch + "expected Snapshot");
  }
  return cast(reference(cast(base), 'parent'), 'Snapshot');
}

function snapshotValue(exp) {
  return call(reference(cast(exp), 'val'), []);
}

function ensureValue(exp) {
  if (exp.valueType == 'Snapshot') {
    return snapshotValue(exp);
  }
  return exp;
}

// Ensure expression is a boolean (when used in a boolean context).
function ensureBoolean(exp) {
  exp = ensureValue(exp);
  if (isCall(exp, 'val')) {
    exp = eq(exp, boolean(true));
  }
  return exp;
}

function isCall(exp, methodName) {
  return exp.type == 'call' && exp.ref.type == 'ref' && exp.ref.accessor == methodName;
}

function valueGen(type) {
  return function(value) {
    return { type: type, value: value };
  };
}

function opGen(opType, arity) {
  if (arity === undefined) {
    arity = 2;
  }
  return function(/* variable */) {
    if (arguments.length != arity) {
      throw new Error("Operator has " + arguments.length +
                      " arguments (expecting " + arity + ").");
    }
    return op(opType, util.copyArray(arguments));
  };
}

// A reducing function for binary operators - use with [].reduce
// initialValue's in array are ignored (or returned for empty array).
function leftAssociateGen(opType, initialValue) {
  function reducer(result, current) {
    if (result === undefined) {
      return current;
    }
    if (current.type == initialValue.type && current.value == initialValue.value) {
      return result;
    }
    return op(opType, [result, current]);
  }

  return function(a) {
    if (a.length == 0) {
      return initialValue;
    }
    return a.reduce(reducer);
  };
}

function op(opType, args) {
  return { type: 'op', op: opType, args: args };
}

function array(args) {
  return { type: 'Array', value: args };
}

function method(params, body) {
  return {
    params: params,
    body: body
  };
}

function Symbols() {
  this.functions = {};
  this.paths = {};
  this.schema = {};
  this.log = {
    error: function(s) { console.error(s); },
    warn: function(s) { console.warn(s); },
  };
}

util.methods(Symbols, {
  register: function(type, name, object) {
    if (!this[type]) {
      throw new Error("Invalid registration type: " + type);
    }

    if (this[type][name]) {
      this.log.error("Duplicated " + type + " definition: " + name + ".");
      return;
    }
    this[type][name] = object;
  },

  registerFunction: function(name, params, body) {
    var fn = {
      params: params,
      body: body
    };
    this.register('functions', name, fn);
  },

  registerPath: function(parts, isType, methods) {
    methods = methods || {};

    isType = isType || 'Any';
    var p = {
      parts: parts,
      isType: isType,
      methods: methods
    };
    this.register('paths', '/' + parts.join('/'), p);
  },

  registerSchema: function(name, derivedFrom, properties, methods) {
    methods = methods || {};
    properties = properties || {};

    derivedFrom = derivedFrom || (Object.keys(properties).length > 0 ? 'Object' : 'Any');
    var s = {
      derivedFrom: derivedFrom,
      properties: properties,
      methods: methods
    };
    this.register('schema', name, s);
  },

  isDerivedFrom: function(descendant, ancestor, visited) {
    if (!visited) {
      visited = {};
    }
    if (visited[descendant]) {
      return false;
    }
    visited[descendant] = true;

    if (descendant == ancestor) {
      return true;
    }

    var schema = this.schema[descendant];
    if (!schema) {
      return false;
    }
    return this.isDerivedFrom(schema.derivedFrom, ancestor, visited);
  },

  setLoggers: function(loggers) {
    this.log = loggers;
  }
});