# -*- coding: utf-8 -*-
#########################################################################
#    License, authors, contributors and copyright information at:       #
#    AUTHORS and LICENSE files at the root folder of this application   #
#########################################################################

import atlantos_qc
import pathlib

absolute_path_string = atlantos_qc.__path__.__dict__["_path"][0]
print(pathlib.Path(absolute_path_string).as_uri())

# NOTE: This should work, in fact, it worked once:
# import importlib
# print(importlib.util.find_spec('atlantos_qc').submodule_search_locations._path[0])