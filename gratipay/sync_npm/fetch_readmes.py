# -*- coding: utf-8 -*-
"""Subcommand for fetching readmes.
"""
from __future__ import absolute_import, division, print_function, unicode_literals

import requests

from . import log
from ..utils.threaded_map import threaded_map


def fetch_from_public_registry(package_name):
    """Fetch a package from the public npm registry.
    """
    r = requests.get('https://registry.npmjs.com/' + package_name)
    if r.status_code != 200:
        log(r.status_code, 'for', package_name)
        return None
    return r.json()


def Fetcher(db, _fetch):
    def fetch(dirty):
        """Update all info for one package.
        """
        log('fetching', dirty.name)
        full = _fetch(dirty.name)

        if not full:
            return
        elif full['name'] != dirty.name:
            log('expected', dirty.name, 'got', full['name'])
            return
        elif 'readme' not in full:
            log('no readme in', full['name'])
            return

        db.run('''

            UPDATE packages
               SET readme_needs_to_be_processed=true
                 , readme_raw=%s
                 , readme_type=%s
             WHERE package_manager=%s
               AND name=%s

        ''', ( full['readme']
             , 'x-markdown/marky'
             , dirty.package_manager
             , dirty.name
              ))

    return fetch


def main(env, args, db, sentrified, _fetch=fetch_from_public_registry):
    """Populate ``readme_raw`` for all packages where ``readme_raw`` is null.
    The ``readme_type`` is set to ``x-markdown/marky``, and
    ``readme_needs_to_be_processed`` is set to ``true``. If the fetched package
    is missing or malformed, we log the condition and continue. This runs in
    four threads.

    """
    dirty = db.all('SELECT package_manager, name '
                   'FROM packages WHERE readme_raw IS NULL '
                   'ORDER BY package_manager DESC, name DESC')
    threaded_map(sentrified(Fetcher(db, _fetch)), dirty, 4)