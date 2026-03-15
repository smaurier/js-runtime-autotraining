import { defineConfig } from 'vitepress'

export default defineConfig({
  title: 'JS Runtime Course',
  description: 'Formation avancée sur le runtime JavaScript (V8, event loop, mémoire, JIT)',
  lang: 'fr-FR',
  srcDir: '.',

  // Quiz HTML files, visualization HTML files, and lab directories are static assets,
  // not Vitepress markdown pages — ignore their dead link warnings
  ignoreDeadLinks: [
    /\/quizzes\/quiz-\d{2}/,
    /\/visualizations\/(event-loop|call-stack|gc-tricolor|jit-pipeline|hidden-classes)/,
    /\.\/(event-loop|call-stack|gc-tricolor|jit-pipeline|hidden-classes)/,
    /\/labs\/lab-\d{2}/,
  ],

  themeConfig: {
    nav: [
      { text: 'Modules', link: '/modules/00-prerequis-et-vue-ensemble' },
      { text: 'Labs', link: '/labs/lab-01-call-stack-observation/README' },
      { text: 'Quizzes', link: '/quizzes/' },
      { text: 'Visualisations', link: '/visualizations/' },
      { text: 'Glossaire', link: '/glossaire' }
    ],

    sidebar: {
      '/modules/': [
        {
          text: 'Modules',
          items: [
            { text: '00 — Prérequis & Vue d\'ensemble', link: '/modules/00-prerequis-et-vue-ensemble' },
            { text: '01 — Call Stack & Execution Context', link: '/modules/01-call-stack-execution-context' },
            { text: '02 — Scope, Closures & Mémoire', link: '/modules/02-scope-closures-memory' },
            { text: '03 — Event Loop', link: '/modules/03-event-loop' },
            { text: '04 — Microtasks vs Macrotasks', link: '/modules/04-microtasks-macrotasks' },
            { text: '05 — Promises: Implémentation', link: '/modules/05-promises-implementation' },
            { text: '06 — Async/Await sous le capot', link: '/modules/06-async-await-under-the-hood' },
            { text: '07 — Garbage Collector', link: '/modules/07-garbage-collector' },
            { text: '08 — Memory Leaks', link: '/modules/08-memory-leaks' },
            { text: '09 — Architecture V8', link: '/modules/09-v8-architecture' },
            { text: '10 — JIT Compilation', link: '/modules/10-jit-compilation-optimization' },
            { text: '11 — Hidden Classes & IC', link: '/modules/11-hidden-classes-inline-caching' },
            { text: '12 — Performance Patterns', link: '/modules/12-performance-patterns' },
            { text: '13 — Scheduling & Concurrence', link: '/modules/13-scheduling-concurrence' },
            { text: '14 — Projet Final', link: '/modules/14-projet-final' },
            { text: '15 — Debugging Session', link: '/modules/15-debugging-session' }
          ]
        }
      ],
      '/quizzes/': [
        {
          text: 'Quizzes',
          items: [
            { text: 'Tous les quizzes', link: '/quizzes/' },
            { text: 'Quiz 00 — Prérequis', link: '/quizzes/quiz-00-prerequis' },
            { text: 'Quiz 01 — Call Stack', link: '/quizzes/quiz-01-call-stack' },
            { text: 'Quiz 02 — Closures', link: '/quizzes/quiz-02-scope-closures' },
            { text: 'Quiz 03 — Event Loop', link: '/quizzes/quiz-03-event-loop' },
            { text: 'Quiz 04 — Microtasks', link: '/quizzes/quiz-04-microtasks' },
            { text: 'Quiz 05 — Promises', link: '/quizzes/quiz-05-promises' },
            { text: 'Quiz 06 — Async/Await', link: '/quizzes/quiz-06-async-await' },
            { text: 'Quiz 07 — GC', link: '/quizzes/quiz-07-gc' },
            { text: 'Quiz 08 — Memory Leaks', link: '/quizzes/quiz-08-memory-leaks' },
            { text: 'Quiz 09 — V8 Architecture', link: '/quizzes/quiz-09-v8-architecture' },
            { text: 'Quiz 10 — JIT', link: '/quizzes/quiz-10-jit' },
            { text: 'Quiz 11 — Hidden Classes', link: '/quizzes/quiz-11-hidden-classes' },
            { text: 'Quiz 12 — Performance', link: '/quizzes/quiz-12-performance' },
            { text: 'Quiz 13 — Scheduling', link: '/quizzes/quiz-13-scheduling' },
            { text: 'Quiz 14 — Projet Final', link: '/quizzes/quiz-14-projet-final' },
            { text: 'Quiz 15 — Debugging', link: '/quizzes/quiz-15-debugging' }
          ]
        }
      ],
      '/visualizations/': [
        {
          text: 'Visualisations',
          items: [
            { text: 'Toutes les visualisations', link: '/visualizations/' },
            { text: 'Event Loop', link: '/visualizations/event-loop.html' },
            { text: 'Call Stack', link: '/visualizations/call-stack.html' },
            { text: 'GC Tri-color', link: '/visualizations/gc-tricolor.html' },
            { text: 'Pipeline JIT', link: '/visualizations/jit-pipeline.html' },
            { text: 'Hidden Classes', link: '/visualizations/hidden-classes.html' }
          ]
        }
      ]
    },

    search: {
      provider: 'local'
    },

    outline: {
      level: [2, 3],
      label: 'Sur cette page'
    },

    docFooter: {
      prev: 'Précédent',
      next: 'Suivant'
    }
  }
})
