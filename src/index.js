var nodeReadFile = require('fs').readFile;
var path = require('path');
var request = require('sync-request');
var compareFunc = require('compare-func');
var Q = require('q');

var readFile = Q.denodeify(nodeReadFile);

var priorities = {
  1: ':arrow_up:',
  2: ':arrow_double_up:',
  3: ':arrow_up_small:',
  4: ':arrow_double_down:',
  5: ':arrow_down_small:'
};

var foundIssues = {};

var parserOpts = {
  headerPattern: /^(\w*): (.*)$/,
  headerCorrespondence: [
    'type',
    'subject'
  ],
  issuePrefixes: 'COB-',
  referenceActions: null,
  noteKeywords: ['BREAKING CHANGE', 'BREAKING CHANGES'],
  revertPattern: /^revert:\s([\s\S]*?)\s*This reverts commit (\w*)\./,
  revertCorrespondence: ['header', 'hash']
};

// eslint-disable-next-line no-process-env
var jiraCredentials = escape(process.env.JIRA_USERNAME) + ':' + escape(process.env.JIRA_PASSWORD);
// eslint-disable-next-line no-process-env
var jiraURL = 'https://' + jiraCredentials + '@' + process.env.JIRA_URL + '/rest/api/latest/issue/';

var getIssue = function (key) {
  if (!foundIssues[key]) {
    // eslint-disable-next-line no-console
    console.log('Retrieving issue ' + key);

    try {
      var res = request('GET', jiraURL + key);
      var details = JSON.parse(res.getBody('utf8'));

      foundIssues[key] = {
        key: details.key,
        subtask: details.fields.issuetype.subtask,
        type: details.fields.issuetype.name,
        summary: details.fields.summary,
        priority: priorities[details.fields.priority.id]
      };

      if (details.fields.parent) {
        foundIssues[key].parentKey = details.fields.parent.key;
      }
    } catch (error) {
      // eslint-disable-next-line no-console
      console.error('Error while retrieving issue ' + key + ' [' + error.statusCode + ']');

      return {};
    }
  }

  return foundIssues[key];
};

var writerOpts = {
  transform: function (commit) {
    commit.notes.forEach(function (note) {
      note.title = 'BREAKING CHANGES';
    });

    commit.references = commit.references
      .forEach(function (reference) {
        // eslint-disable-next-line no-console
        console.log('Found reference ' + reference.issue);
        var key = 'COB-' + parseInt(reference.issue, 10).toString();

        if (!foundIssues[key]) {
          var issue = getIssue(key);

          if (issue.subtask) {
            // Issue is a subtask. Append it to the parent subtasks
            var parentIssue = getIssue(issue.parentKey);

            parentIssue.subtasks = parentIssue.subtasks || [];
            parentIssue.subtasks.push(issue);
          }
        }
      });

    if (typeof commit.hash === 'string') {
      commit.hash = commit.hash.substring(0, 7);
    }

    return commit;
  },
  finalizeContext: function (context) {
    var groupedIssues = Object.keys(foundIssues)
      .reduce(function (map, key) {
        var issue = foundIssues[key];

        if (!issue.subtask) {
          map[issue.type] = map[issue.type] || [];
          map[issue.type].push(issue);
        }

        return map;
      }, {});

    var groupsList = Object.keys(groupedIssues)
      .map(function (key) {
        return {
          title: key,
          commits: groupedIssues[key]
        };
      });

    context.commitGroups = groupsList;
    foundIssues = {};

    return context;
  },
  groupBy: 'type',
  commitGroupsSort: 'title',
  commitsSort: ['scope', 'subject'],
  noteGroupsSort: 'title',
  notesSort: compareFunc
};

module.exports = Q.all([
  readFile(path.resolve(__dirname, 'templates/template.hbs'), 'utf-8'),
  readFile(path.resolve(__dirname, 'templates/header.hbs'), 'utf-8'),
  readFile(path.resolve(__dirname, 'templates/commit.hbs'), 'utf-8'),
  readFile(path.resolve(__dirname, 'templates/footer.hbs'), 'utf-8')
])
  .spread(function (template, header, commit, footer) {
    writerOpts.mainTemplate = template;
    writerOpts.headerPartial = header;
    writerOpts.commitPartial = commit;
    writerOpts.footerPartial = footer;

    return {
      parserOpts: parserOpts,
      writerOpts: writerOpts
    };
  });
