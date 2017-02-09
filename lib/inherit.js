'use strict';

Object.defineProperty(exports, "__esModule", {
  value: true
});

var _createClass = function () { function defineProperties(target, props) { for (var i = 0; i < props.length; i++) { var descriptor = props[i]; descriptor.enumerable = descriptor.enumerable || false; descriptor.configurable = true; if ("value" in descriptor) descriptor.writable = true; Object.defineProperty(target, descriptor.key, descriptor); } } return function (Constructor, protoProps, staticProps) { if (protoProps) defineProperties(Constructor.prototype, protoProps); if (staticProps) defineProperties(Constructor, staticProps); return Constructor; }; }();

function _classCallCheck(instance, Constructor) { if (!(instance instanceof Constructor)) { throw new TypeError("Cannot call a class as a function"); } }

function _toConsumableArray(arr) { if (Array.isArray(arr)) { for (var i = 0, arr2 = Array(arr.length); i < arr.length; i++) { arr2[i] = arr[i]; } return arr2; } else { return Array.from(arr); } }

var debug = require('debug')('postcss-inherit');
var postcss = require('postcss');
var fs = require('fs');
var path = require('path');

/**
 * Private: checks if a node is a decendant of an [AtRule](http://api.postcss.org/AtRule.html).
 *
 * * `node` {Object} PostCSS Node to check.
 *
 * Returns {Boolean} of false, or {String} of AtRule params if true.
 */
function _isAtruleDescendant(node) {
  var parent = node.parent;

  var descended = false;

  while (parent && parent.type !== 'root') {
    if (parent.type === 'atrule') {
      descended = parent.params;
    }
    parent = parent.parent;
  }
  return descended;
}
/**
 * Private: checks string to see if it has the placeholder syntax (starts with %)
 *
 * * `val` a {String} intended for inherit value or rule name.
 *
 * Returns {Boolean}
 */
function _isPlaceholder(val) {
  return val[0] === '%';
}
/**
 * Private: gets a string ready to use in a regular expression.
 *
 * * `str` {String} to escape RegExp reserved characters.
 *
 * Returns {String} for use in a regualr expression.
 */
function _escapeRegExp(str) {
  return str.replace(/[-[\]/{}()*+?.\\^$|]/g, '\\$&');
}
/**
 * Private: creates a regular expression used to find rules that match inherit property.
 *
 * * `val` {String} inherit property to use to find selectors that contain it.
 *
 * Returns {RegExp} used for finding rules that match inherit property.
 */
function _matchRegExp(val) {
  var expression = _escapeRegExp(val) + '($|\\s|\\>|\\+|~|\\:|\\[)';
  var expressionPrefix = '(^|\\s|\\>|\\+|~)';
  if (_isPlaceholder(val)) {
    // We just want to match an empty group here to preserve the arguments we
    // may be expecting in a RegExp match.
    expressionPrefix = '()';
  }
  return new RegExp(expressionPrefix + expression, 'g');
}
/**
 * Private: creates a regular expression used to replace selector with inherit property inserted
 *
 * * `val` {String} inherit property to use to replace selectors that contain it.
 *
 * Returns {RegExp} used to replace selector with inherit property inserted
 */
function _replaceRegExp(val) {
  var operatorRegex = /(::?|\[)/g;
  var newVal = val.match(operatorRegex) ? val.substring(0, val.search(operatorRegex)) : val;
  return _matchRegExp(newVal);
}
/**
 * Private: replaces selector with inherit property inserted.
 *
 * * `matchedSelector` {String} selector of the rule that matches the inherit value
 * * `val` {String} value of the inherit property
 * * `selector` {String} selector of the rule that contains the inherit declaration.
 *
 * Returns {String} new selector.
 */
function _replaceSelector(matchedSelector, val, selector) {
  return matchedSelector.replace(_replaceRegExp(val), function (_, first, last) {
    return first + selector + last;
  });
}
/**
 * Private: turns a portion of a selector into a placeholder (adding a %)
 *
 * * `selector` {String} of the selector to replace
 * * `value` {String} portion of the selector to convert into a placeholder
 *
 * Returns the transformed selector string {String}
 */
function _makePlaceholder(selector, value) {
  return selector.replace(_replaceRegExp(value), function (_, first, last) {
    return first + '%' + _.trim() + last;
  });
}
/**
 * Private: splits selectors divided by a comma
 *
 * * `selector` {String} comma delimited selectors.
 *
 * Returns {Array} of selector {Strings}
 */
function _parseSelectors(selector) {
  return selector.split(',').map(function (x) {
    return x.trim();
  });
}
/**
 * Private: reassembles an array of selectors, usually split by `_parseSelectors`
 *
 * * `selectors` {Array} of selector {Strings}
 *
 * Returns selector {String}
 */
function _assembleSelectors(selectors) {
  return selectors.join(',\n');
}
/**
 * Private: checks if value is already contained in a nested object.
 *
 * * `object` {Object} that might contain the value
 * * `key` {String} key of the nested object that might contain the value
 * * `value` {String} to check for
 *
 * Returns {Boolean}
 */
function _mediaMatch(object, key, value) {
  if (!{}.hasOwnProperty.call(object, key)) {
    return false;
  }
  return Boolean(object[key].indexOf(value) >= 0);
}
/**
 * Private: removes PostCSS Node and all parents if left empty after removal.
 *
 * * `node` {Object} PostCSS Node to check.
 */
function _removeParentsIfEmpty(node) {
  var currentNode = node.parent;
  node.remove();
  while (!currentNode.nodes.length) {
    var parent = currentNode.parent;
    currentNode.remove();
    currentNode = parent;
  }
}
/**
 * Private: use a regex to see if something is contained in array values.
 *
 * * `array` {Array} that might contain a match
 * * `regex` {RegExp} used to test values of `array`
 *
 * Returns {Int} index of array that matched.
 */
function _findInArray(array, regex) {
  var result = -1;
  array.forEach(function (value, index) {
    if (regex.test(value)) result = index;
  });
  return result;
}
/**
 *  Private: removes whitespace (like `trim()`) and quotes at beginning and extend.
 *
 *  * `paramStr` {String} to clean (params property of at AtRule)
 *
 *  Returns cleaned {String}
 */
function _cleanParams(paramStr) {
  var regexp = /(^(?:(?:\s*")|(?:\s*')))|((?:(?:"\s*)|(?:'\s*))$)/g;
  return paramStr.replace(regexp, '');
}
/**
 *  Private: copies rule from one location to another.
 *  Used to copy rules from root that match inherit value in a PostCSS AtRule.
 *  Rule copied before the rule that contains the inherit declaration.
 *  Does not return a value, but it transforms the PostCSS AST.
 *
 *  * `originRule` {Object} PostCSS Rule (in the atRule) that contains inherit declaration
 *  * `targetRule` {Object} PostCSS Rule (in root) that matches inherit property
 *
 *  Returns copied {Object} PostCSS Rule.
 */
function _copyRule(originRule, targetRule) {
  var newRule = targetRule.cloneBefore();
  newRule.moveBefore(originRule);
  return newRule;
}
/**
 * Private: appends selector from originRule to matching rules.
 * Does not return a value, but it transforms the PostCSS AST.
 *
 * * `originSelector` {String} selector from originRule to append
 * * `targetRule` {Object} PostCSS Rule that matched value.
 *   Will have originSelector appended to it
 * * `value` {String} inherit declaration value
 */
function _appendSelector(originSelector, targetRule, value) {
  var originSelectors = _parseSelectors(originSelector);
  var targetRuleSelectors = _parseSelectors(targetRule.selector);
  targetRuleSelectors.forEach(function (targetRuleSelector) {
    [].push.apply(targetRuleSelectors, originSelectors.map(function (newOriginSelector) {
      return _replaceSelector(targetRuleSelector, value, newOriginSelector);
    }));
  });
  // removes duplicate selectors
  targetRuleSelectors = [].concat(_toConsumableArray(new Set(targetRuleSelectors)));
  targetRule.selector = _assembleSelectors(targetRuleSelectors);
}
/**
 * Inherit Class
 */

var Inherit = function () {
  /**
   *  Public: Inherit class constructor. Does not return a value, but it transforms the PostCSS AST.
   *
   *  * `css` {Object} PostCSS AST that will be transformed by the inherit plugin
   *  * `opts` {Object} of inherit plugin specific options
   *    * `propertyRegExp` {RegExp} to use for AtRule name (defaults to use inherit(s)/extend(s)).
   *
   *  ## Examples
   *
   *  ```js
   *  export default postcss.plugin('postcss-inherit',
   *    (opts = {}) =>
   *      css =>
   *        new Inherit(css, opts)
   *  );
   *  ```
   */
  function Inherit(css, opts) {
    var _this = this;

    _classCallCheck(this, Inherit);

    this.root = css;
    this.matches = {};
    this.globalStyles = opts.globalStyles ? postcss.parse(fs.readFileSync(path.join(process.cwd(), opts.globalStyles), { encoding: 'utf-8' })) : null;
    this.propertyRegExp = opts.propertyRegExp || /^(inherit|extend)s?:?$/i;
    this.root.walkAtRules('media', function (atRule) {
      _this._atRuleInheritsFromRoot(atRule);
    });
    console.log(this.root.toString());
    this.root.walkAtRules(this.propertyRegExp, function (importRule) {
      var rule = importRule.parent;
      var importValue = _cleanParams(importRule.params);
      _parseSelectors(importValue).forEach(function (value) {
        _this._inheritRule(value, rule, importRule);
      });
      _removeParentsIfEmpty(importRule);
    });
    this._removePlaceholders();
  }
  /**
   * Private: copies rules from root when inherited in an atRule descendant.
   * Does not return a value, but it transforms the PostCSS AST.
   *
   * * `atRule` {Object} PostCSS AtRule
   */


  _createClass(Inherit, [{
    key: '_atRuleInheritsFromRoot',
    value: function _atRuleInheritsFromRoot(atRule) {
      var _this2 = this;

      atRule.walkAtRules(this.propertyRegExp, function (importRule) {
        var originRule = importRule.parent;
        var importValue = _cleanParams(importRule.params);
        var originAtParams = _isAtruleDescendant(originRule);
        var newValueArray = [];
        _parseSelectors(importValue).forEach(function (value) {
          var targetSelector = value;
          var newValue = value;
          _this2.globalStyles.walkRules(function (rule) {
            if (!_matchRegExp(targetSelector).test(rule.selector)) return;
            var targetAtParams = _isAtruleDescendant(rule);
            if (!targetAtParams) {
              newValue = '%' + value;
            } else {
              return;
            }
            if (!_mediaMatch(_this2.matches, originAtParams, targetSelector)) {
              var newRule = _copyRule(originRule, rule);
              newRule.selector = _makePlaceholder(newRule.selector, targetSelector);
              _this2.matches[originAtParams] = _this2.matches[originAtParams] || [];
              _this2.matches[originAtParams].push(targetSelector);
              _this2.matches[originAtParams] = [].concat(_toConsumableArray(new Set(_this2.matches[originAtParams])));
            }
          });
          newValueArray.push(newValue);
        });
        importRule.params = newValueArray.join(', ');
      });
    }
    /**
     * Private: Finds selectors that match value and add the selector for the originRule as needed.
     * Does not return a value, but it transforms the PostCSS AST.
     *
     * * `value` {String} inherit declaration value
     * * `originRule` {Object} the PostCSS Rule that contains the inherit declaration
     * * `decl` {Object} the original inherit PostCSS Declaration
     */

  }, {
    key: '_inheritRule',
    value: function _inheritRule(value, originRule, decl) {
      var _this3 = this;

      var originSelector = originRule.selector;
      var originAtParams = originRule.atParams || _isAtruleDescendant(originRule);
      var targetSelector = value;
      var matched = false;
      var differentLevelMatched = false;

      this.globalStyles.walkRules(function (rule) {
        if (_findInArray(_parseSelectors(rule.selector), _matchRegExp(targetSelector)) === -1) return;
        var targetRule = rule;
        var targetAtParams = targetRule.atParams || _isAtruleDescendant(targetRule);
        if (targetAtParams === originAtParams) {
          // console.log('extend %j with %j', originSelector, targetRule, targetSelector);
          // console.log('targetRule', targetRule)
          // console.log('before appending', targetRule.toString())
          _appendSelector(originSelector, targetRule, targetSelector);
          var clone = targetRule.clone();
          // console.log('after appending', clone.toString())
          _this3.root.append(clone);
          matched = true;
        } else {
          differentLevelMatched = true;
        }
      });

      this.root.walkRules(function (rule) {
        if (_findInArray(_parseSelectors(rule.selector), _matchRegExp(targetSelector)) === -1) return;
        var targetRule = rule;
        var targetAtParams = targetRule.atParams || _isAtruleDescendant(targetRule);
        if (targetAtParams === originAtParams) {
          // console.log('extend %j with %j', originSelector, targetRule, targetSelector);
          // console.log('targetRule', targetRule)
          // console.log('before appending', targetRule.toString())
          _appendSelector(originSelector, targetRule, targetSelector);
          var clone = targetRule.clone();
          // console.log('after appending', clone.toString())
          // this.root.append(clone)
          matched = true;
        } else {
          differentLevelMatched = true;
        }
      });
      if (!matched) {
        if (differentLevelMatched) {
          throw decl.error('Could not find rule that matched ' + value + ' in the same atRule.');
        } else {
          throw decl.error('Could not find rule that matched ' + value + '.');
        }
      }
    }
    /**
     * Private: after processing inherits, this method is used to remove all placeholder rules.
     * Does not return a value, but it transforms the PostCSS AST.
     */

  }, {
    key: '_removePlaceholders',
    value: function _removePlaceholders() {
      this.root.walkRules(/^%|\s+%|\w%\w/, function (rule) {
        var selectors = _parseSelectors(rule.selector);
        var newSelectors = selectors.filter(function (selector) {
          return selector.indexOf('%') === -1;
        });
        if (!newSelectors.length) {
          rule.remove();
        } else {
          rule.selector = _assembleSelectors(newSelectors);
        }
      });
    }
  }]);

  return Inherit;
}();

exports.default = Inherit;
module.exports = exports['default'];