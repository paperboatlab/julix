The Julia session
=================

Julix holds one Julia session per folder, on a lease from ``paperboatd``: the runtime runs in a
container and pulls its image the first time. Run without the Launcher, Julix finds ``paperboatd`` on
``PATH`` (the ``paperboat-cli`` package) or at ``$PAPERBOATD``.

.. note:: Not written yet: restarting the session, packages, what survives a restart.
