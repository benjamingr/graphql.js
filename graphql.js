(function () {
  function __extend() {
    var extended = {}, deep = false, i = 0, length = arguments.length
    if (Object.prototype.toString.call( arguments[0] ) == '[object Boolean]') {
      deep = arguments[0]
      i++
    }
    var merge = function (obj) {
      for (var prop in obj) {
        if (Object.prototype.hasOwnProperty.call(obj, prop)) {
          if (deep && Object.prototype.toString.call(obj[prop]) == '[object Object]') {
            extended[prop] = __extend(true, extended[prop], obj[prop])
          } else {
            extended[prop] = obj[prop]
          }
        }
      }
    }
    
    for (; i < length; i++) {
      var obj = arguments[i]
      merge(obj)
    }
    
    return extended
  }
  
  function __xhr() {
    if (window.XMLHttpRequest) {
      return new window.XMLHttpRequest
    } else {
      try { return new ActiveXObject("MSXML2.XMLHTTP.3.0") } catch(ex) { return null }
    }
  }
  
  function __request(method, url, headers, data, callback) {
    var body = "query=" + escape(data.query) + "&variables=" + escape(JSON.stringify(data.variables))
    if (typeof XMLHttpRequest != 'undefined') {
      var xhr = __xhr()
      xhr.open(method, url, true)
      xhr.setRequestHeader('Content-type', 'application/x-www-form-urlencoded')
      xhr.setRequestHeader('Accept', 'application/json')
      for (var key in headers) { xhr.setRequestHeader(key, headers[key]) }
      xhr.onerror = function () { callback(xhr, xhr.status) }
      xhr.onload = function () { callback(JSON.parse(xhr.responseText), xhr.status) }
      xhr.send(body)
    } else if (typeof require == 'function') {
      var http = require('http'), URL = require('url'), uri = URL.parse(url)
      var req = http.request({
        protocol: uri.protocol,
        hostname: uri.hostname,
        port: uri.port,
        path: uri.path,
        method: "POST",
        headers: __extend({
          'Content-type': 'application/x-www-form-urlencoded',
          'Accept': 'application/json'
        }, headers)
      }, function (response) {
        var str = ''
        response.setEncoding('utf8')
        response.on('data', function (chunk) { str += chunk })
        response.on('end', function () {
          callback(JSON.parse(str), response.statusCode)
        })
      })
      req.write(body)
      req.end()
    }
  }
  
  function __isTagCall(strings) {
    return Object.prototype.toString.call(strings) == '[object Array]' && strings.raw
  }
  
  function GraphQLClient(url, options) {
    if (!(this instanceof GraphQLClient)) {
      var client = new GraphQLClient(url, options, true)
      var _lazy = client._sender
      for (var m in client) {
        if (typeof client[m] == 'function') {
          _lazy[m] = client[m].bind(client)
          if (client[m].declare) _lazy[m].declare = client[m].declare.bind(client)
          if (client[m].run) _lazy[m].run = client[m].run.bind(client)
        }
      }
      return _lazy
    } else if (arguments[2] !== true) {
      throw "You cannot create GraphQLClient instance. Please call GraphQLClient as function."
    }
    if (!options)
    options = {}
    
    if (!options.fragments)
    options.fragments = {}
    
    this.options = options
    this._fragments = this.buildFragments(options.fragments)
    this._sender = this.createSenderFunction(url)
    this.createHelpers(this._sender)
  }
  
  // "fragment auth.login" will be "fragment auth_login"
  FRAGMENT_SEPERATOR = "_"
  
  // The autodeclare keyword.
  GraphQLClient.AUTODECLARE_PATTERN = /\(@autodeclare\)|\(@autotype\)/
  
  GraphQLClient.FRAGMENT_PATTERN = /\.\.\.\s*([A-Za-z0-9\.\_]+)/g
  
  // Flattens nested object
  /*
  * {a: {b: {c: 1, d: 2}}} => {"a.b.c": 1, "a.b.d": 2}
  */
  GraphQLClient.prototype.flatten = function (object) {
    var prefix = arguments[1] || "", out = arguments[2] || {}, name
    for (name in object) {
      if (object.hasOwnProperty(name)) {
        typeof object[name] == "object"
        ? this.flatten(object[name], prefix + name + FRAGMENT_SEPERATOR, out)
        : out[prefix + name] = object[name]
      }
    }
    return out
  }
  
  // Gets path from object
  /*
  * {a: {b: {c: 1, d: 2}}}, "a.b.c" => 1
  */
  GraphQLClient.prototype.fragmentPath = function (fragments, path) {
    var getter = new Function("fragments", "return fragments." + path.replace(/\./g, FRAGMENT_SEPERATOR))
    var obj = getter(fragments)
    if (path != "on" && (!obj || typeof obj != "string")) {
      throw "Fragment " + path + " not found"
    }
    return obj
  }
  
  GraphQLClient.prototype.collectFragments = function (query, fragments) {
    var that = this
    var fragmentRegexp = GraphQLClient.FRAGMENT_PATTERN
    var collectedFragments = []
    ;(query.match(fragmentRegexp)||[]).forEach(function (fragment) {
      var path = fragment.replace(fragmentRegexp, function (_, $m) {return $m})
      var fragment = that.fragmentPath(fragments, path)
      if (fragment) {
        var pathRegexp = new RegExp(fragmentRegexp.source.replace(/\((.*)\)/, path))
        if (fragment.match(pathRegexp)) {
          throw "Recursive fragment usage detected on " + path + "."
        }
        collectedFragments.push(fragment)
        // Collect sub fragments
        var alreadyCollectedFragments = collectedFragments.filter(function (alreadyCollected) {
          return alreadyCollected.match(new RegExp("fragment " + path))
        })
        if (alreadyCollectedFragments.length > 0 && fragmentRegexp.test(fragment)) {
          that.collectFragments(fragment, fragments).forEach(function (fragment) {
            collectedFragments.unshift(fragment)
          })
        }
      }
    })
    return collectedFragments
  }
  
  GraphQLClient.prototype.processQuery = function (query, fragments) {
    var fragmentRegexp = GraphQLClient.FRAGMENT_PATTERN
    var collectedFragments = this.collectFragments(query, fragments)
    query = query.replace(fragmentRegexp, function (_, $m) {
      return "... " + $m.split(".").join(FRAGMENT_SEPERATOR)
    })
    return [query].concat(collectedFragments.filter(function (fragment) {
      // Remove already used fragments
      return !query.match(fragment)
    })).join("\n")
  }
  
  GraphQLClient.prototype.autoDeclare = function (query, variables) {
    var typeMap = {
      string: "String",
      number: "Int",
      boolean: "Boolean"
    }
    return query.replace(GraphQLClient.AUTODECLARE_PATTERN, function () {
      var types = []
      for (var key in variables) {
        var value = variables[key]
        var keyAndType = key.split("!")
        var type = (keyAndType[1] || typeMap[typeof(value)])
        if (type) {
          types.push("$" + keyAndType[0] + ": " + type + "!")
        }
      }
      types = types.join(", ")
      return types ? "("+ types +")" : ""
    })
  }
  
  GraphQLClient.prototype.cleanAutoDeclareAnnotations = function (variables) {
    if (!variables) variables = {}
    var newVariables = {}
    for (var key in variables) {
      var value = variables[key]
      var keyAndType = key.split("!")
      newVariables[keyAndType[0]] = value
    }
    return newVariables
  }
  
  GraphQLClient.prototype.buildFragments = function (fragments) {
    var that = this
    fragments = this.flatten(fragments || {})
    var fragmentObject = {}
    for (var name in fragments) {
      var fragment = fragments[name]
      if (typeof fragment == "object") {
        fragmentObject[name] = that.buildFragments(fragment)
      } else {
        fragmentObject[name] = "\nfragment " + name + " " + fragment
      }
    }
    return fragmentObject
  }
  
  GraphQLClient.prototype.buildQuery = function (query, variables) {
    return this.autoDeclare(this.processQuery(query, this._fragments, variables), variables)
  }
  
  GraphQLClient.prototype.createSenderFunction = function (url) {
    var that = this
    return function (query) {
      if (__isTagCall(query)) {
        return that.run(that.ql.apply(that, arguments))
      }
      var caller = function (variables, requestOptions) {
        if (!requestOptions) requestOptions = {}
        if (!variables) variables = {}
        var fragmentedQuery = that.buildQuery(query, variables)
        headers = __extend((that.options.headers||{}), (requestOptions.headers||{}))
        
        return new Promise(function (resolve, reject) {
          __request(that.options.method || "post", url, headers, {
            query: fragmentedQuery,
            variables: that.cleanAutoDeclareAnnotations(variables)
          }, function (response, status) {
            if (status == 200) {
              if (response.errors) {
                reject(response.errors)
              } else if (response.data) {
                resolve(response.data)
              }
            } else {
              reject(response)
            }
          })
        })
      }
      if (arguments.length > 1) {
        return caller.apply(null, Array.prototype.slice.call(arguments, 1))
      }
      return caller
    }
  }
  
  GraphQLClient.prototype.createHelpers = function (sender) {
    var that = this
    function helper(query) {
      if (__isTagCall(query)) {
        that.__prefix = this.prefix
        that.__suffix = this.suffix
        var result = that.run(that.ql.apply(that, arguments))
        that.__prefix = ""
        that.__suffix = ""
        return result
      }
      var caller = sender(this.prefix + " " + query + " " + this.suffix)
      if (arguments.length > 1) {
        return caller.apply(null, Array.prototype.slice.call(arguments, 1))
      } else {
        return caller
      }
    }

    var helpers = [
      {method: 'mutate', type: 'mutation'},
      {method: 'query', type: 'query'},
      {method: 'subscribe', type: 'subscription'}
    ]
    helpers.forEach(function (m) {
      that[m.method] = function (query, options) {
        if (that.options.alwaysAutodeclare === true || (options && options.declare === true)) {
          return helper.call({prefix: m.type + " (@autodeclare) {", suffix: "}"}, query)
        } else {
          return helper.call({prefix: m.type, suffix: ""}, query)
        }
      }
      that[m.method].run = function (query, options) {
        return that[m.method](query, options)({})
      }
    })
    this.run = function (query) {
      return sender(query, {})
    }
  }
  
  GraphQLClient.prototype.fragments = function () {
    return this._fragments
  }
  
  GraphQLClient.prototype.getOptions = function () {
    return this.options
  }
  
  GraphQLClient.prototype.fragment = function (fragment) {
    if (typeof fragment == 'string') {
      var _fragment = this._fragments[fragment.replace(/\./g, FRAGMENT_SEPERATOR)]
      if (!_fragment) {
        throw "Fragment " + fragment + " not found!"
      }
      return _fragment.trim()
    } else {
      this.options.fragments = __extend(true, this.options.fragments, fragment)
      this._fragments = this.buildFragments(this.options.fragments)
      return this._fragments
    }
  }
  
  GraphQLClient.prototype.ql = function (strings) {
    var that = this
    fragments = Array.prototype.slice.call(arguments, 1)
    fragments = fragments.map(function (fragment) {
      if (typeof fragment == 'string') {
        return fragment.match(/fragment\s+([^\s]*)\s/)[1]
      }
    })
    var query = (typeof strings == 'string') ? strings : strings.reduce(function (acc, seg, i) {
      return acc + fragments[i - 1] + seg
    })
    query = this.buildQuery(query)
    query = ((this.__prefix||"") + " " + query + " " + (this.__suffix||"")).trim()
    return query
  }
  
  ;(function (root, factory) {
    if (typeof define === 'function' && define.amd) {
      define(function () {
        return (root.graphql = factory(GraphQLClient))
      });
    } else if (typeof module === 'object' && module.exports) {
      module.exports = factory(root.GraphQLClient)
    } else {
      root.graphql = factory(root.GraphQLClient)
    }
  }(this, function () {
    return GraphQLClient
  }))
})()
