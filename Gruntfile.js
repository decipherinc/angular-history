module.exports = function (grunt) {

  // Project configuration.
  grunt.initConfig({
    qunit: {
      all: {
        options: {
          urls: [
            'http://localhost:8000/test/test-history.html'
          ],
          force: true
        }
      }
    },
    connect: {
      test: {
        options: {
          port: 8000,
          base: '.'
        }
      },
      docs: {
        options: {
          keepalive: true,
          port: 8000,
          base: 'docs'
        }
      }
    },
    bower: {
      install: {
        options: {
          targetDir: './test/lib',
          cleanup: true
        }
      }
    },
    watch: {
      scripts: {
        files: [
          'history.js',
          'test/test-history.html',
          'test/test-history.js'
        ],
        tasks: ['test']
      }
    },
    ngdocs: {
      options: {
        scripts: [
          'test/lib/angular/angular.js',
          'history.js'],
        html5Mode: false
      },
      all: ['history.js']
    },
    clean: ['docs']

  });

  grunt.loadNpmTasks('grunt-contrib-qunit');
  grunt.loadNpmTasks('grunt-contrib-connect');
  grunt.loadNpmTasks('grunt-bower-task');
  grunt.loadNpmTasks('grunt-contrib-watch');
  grunt.loadNpmTasks('grunt-ngdocs');
  grunt.loadNpmTasks('grunt-contrib-clean');

  grunt.registerTask('test', ['bower:install', 'connect:test', 'qunit']);
  grunt.registerTask('testwatch',
    ['bower:install', 'connect:test', 'qunit', 'watch']);
  grunt.registerTask('default',
    ['clean', 'bower:install', 'ngdocs', 'connect:docs']);

  grunt.event.on('qunit.log',
    function (result, actual, expected, message) {
      if (!!result) {
        grunt.log.ok(message);
      }
    });
};
