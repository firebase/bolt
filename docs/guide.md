# Firebase Security and Rules Using Bolt

Firebase is secured using a JSON-formatted [Security and
Rules](https://www.firebase.com/docs/security/guide/understanding-security.html) language. It
is a powerful feature of Firebase, but can be error prone to write by hand.

The Bolt compiler helps developers express the schema and authorization rules for their
database using a familiar JavaScript-like language. The complete [language
reference](language.md) describes the syntax. This guide introduces the concepts and
features of Bolt along with a cookbook of common recipies.

# Getting Started

The Firebase Bolt compiler is a command-line based tool, written in node.js. You can install it
using the [Node Package Manager](https://nodejs.org/en/download/):

    $ npm install --global firebase-bolt

You can use the Bolt compiler to compile the examples in this tutorial, and inspect the output.

## Default Firebase Permissions

By default, Firebase has a permissive security model - this makes it easy to test your code
(but is unsafe for production apps since anyone can read and overwrite all your data). In Bolt,
these default permissions can be written as:

[all_access.bolt](../samples/all_access.bolt)
```javascript
path / {
  read() = true;
  write() = true;
}
```

This _path_ statement, defines read and write permissions to every part of your database
(all paths beneath the root (`/`) of the database).  The `read` and `write` methods are defined
using the syntax `read() = <expression>;`.  When the expression evaluates to `true`, reading
(or writing) is allow at the given path location (and all children of that path).

Use the Bolt compiler to convert this to Firebase JSON-formatted rules:

    $ firebase-bolt < all_access.bolt

```JSON
{
  "rules": {
    ".read": "true",
    ".write": "true"
  }
}
```

## How to Use Bolt in Your Application

Bolt is (not yet) integrated into the online [Firebase Security and Rules
Dashboard](https://www.firebase.com/account/). There are two ways to use Bolt to define rules
for your application:

1. Use the firebase-bolt command line tool to generate a JSON file from your Bolt file, and
   then copy and paste the result into the Dashboard _Security and Rules_ section.
2. Use the [Firebase Command Line](https://www.firebase.com/docs/hosting/command-line-tool.html)
   tool.  If you have _firebase-bolt_ installed on your computer, you can set the `rules` property
   in your [firebase.json](https://www.firebase.com/docs/hosting/guide/full-config.html) file
   to the name of your Bolt file.  When you use the `deploy` command, the command line will
   read and compile your Bolt file and upload the compiled JSON to your application Rules.

## Data Validation

The Firebase database is "schemaless" - which means that, unless you specify otherwise, any
type or structure of data can be written anywhere in the database. By specifying a specific
schema, you can catch coding errors early, and prevent malicious programs from writing data
that you don't expect.

Lets say your application wants to allow users to write messages to your database. Each message
can be up to 140 characters and must by _signed_ by the user. In Bolt, you can express this
using a `type` statement:

_posts.bolt_
```javascript
// Allow anyone to read the list of Posts.
path /posts {
  read() = true;
}

// All individual Posts are writable by anyone.
path /posts/$id is Post {
  write() = true;
}

type Post {
  validate() = this.message.length <= 140;

  message: String,
  from: String
}
```

This database allows for a collection of `Posts` to be stored at the `/posts` path. Each one
must have a unique ID key. Note that a path expression (after the `path` keyword) can contain a
_wildcard_ component. This matches any string, and the value of the match is available to be
used in expressions, if desired.

For example, writing data at `/posts/123' will match the `path` statement when `$id` is equal
to (the string) '123'.

The Post type allows for exactly two string properties in each post (message and
from). It also ensures that no message is longer than 140 characters.

Bolt type statements can contain a `validate()` method (defined as `validate() = <expression>`,
where the expression evaluates to a `true` value if the data is the type is valid (can be saved
to the database). When the expression evaluates to `false`, the attempt to write the data will
return an error to the Firebase client and the database will be unmodified.

To access properties of a type in an expression, use the `this` variable  (e.g. `this.message`).

    $ firebase-bolt < posts.bolt

```JSON
{
  "rules": {
    "posts": {
      ".read": "true",
      "$id": {
        ".validate": "newData.hasChildren(['message', 'from']) && newData.child('message').val().length <= 140",
        "message": {
          ".validate": "newData.isString()"
        },
        "from": {
          ".validate": "newData.isString()"
        },
        "$other": {
          ".validate": "false"
        },
        ".write": "true"
      }
    }
  }
}
```

Bolt supports the built-in datatypes of `String`, `Number`, `Boolean`, `Object`, `Any`, and
`Null` (`Null` is useful for specifying optional properties):

_sample.bolt_
```javascript
path / is Sample;

type Sample {
  name: String,
  age: Number,
  isMember: Boolean,

  // The | type-operator allows this type to be an Object or undefined (null in Firebase).
  attributes: Object | Null
}
```

    $ firebase-bolt < sample.bolt

```JSON
{
  "rules": {
    ".validate": "newData.hasChildren(['name', 'age', 'isMember'])",
    "name": {
      ".validate": "newData.isString()"
    },
    "age": {
      ".validate": "newData.isNumber()"
    },
    "isMember": {
      ".validate": "newData.isBoolean()"
    },
    "attributes": {
      ".validate": "newData.hasChildren() || newData.val() == null"
    },
    "$other": {
      ".validate": "false"
    }
  }
}
```

## Extending Builtin Types

Bolt allows user-defined types to extend the built-in types.  This can make it easier for you
to define a validation expression in one place, and use it in several places.  For example,
suppose we have several places where we use a _NameString_ - and we require that it be a non-empty
string of no more than 32 characters:

```javascript
path /users/$id is User;
path /rooms/$id is Room;

type User {
  name: NameString,
  isAdmin: Boolean
}

type Room {
  name: NameString,
  creator: String
}

type NameString extends String {
  validate() = this.length > 0 && this.length <= 32;
}
```

_NameString_ can be used anywhere the String type can be used - but it adds the additional
validation constraint that it be non-empty and not too long.  Note that the `this` keyword
refers to the value of the string in this case.

This example compiles to:

```JSON
{
  "rules": {
    "users": {
      "$id": {
        ".validate": "newData.hasChildren(['name', 'isAdmin'])",
        "name": {
          ".validate": "newData.isString() && newData.val().length > 0 && newData.val().length <= 32"
        },
        "isAdmin": {
          ".validate": "newData.isBoolean()"
        },
        "$other": {
          ".validate": "false"
        }
      }
    },
    "rooms": {
      "$id": {
        ".validate": "newData.hasChildren(['name', 'creator'])",
        "name": {
          ".validate": "newData.isString() && newData.val().length > 0 && newData.val().length <= 32"
        },
        "creator": {
          ".validate": "newData.isString()"
        },
        "$other": {
          ".validate": "false"
        }
      }
    }
  }
}
```

# Bolt Cookbook

The rest of this guide will provide sample recipes to solve typical problems that developers
face in securing their Firebase database.

## Restrict Users from Reading (Modifying) Other's Data

## Dealing with Time

## Allowing Creation, but Disallow Modification of Data

## Don't Overwrite Data w/o Reading it First