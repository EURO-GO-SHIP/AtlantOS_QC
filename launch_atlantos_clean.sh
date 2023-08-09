#!/bin/bash

DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" >/dev/null 2>&1 && pwd )"

cd $DIR
git pull origin
source /Users/avelo/miniconda3/etc/profile.d/conda.sh


# clean environment and packages
#mv env /tmp/
rm -rf build
rm -rf dist
rm -rf env
rm -rf ocean_data_qc_js/node_modules
rm -rf ocean_data_qc_js/dist

# create environment
#CONDA_SUBDIR=osx-arm64 conda create --prefix env python=3.10
conda create --prefix env python=3.11
#conda activate env
conda activate $DIR/env
python -m pip install --upgrade pip
pip install --upgrade setuptools

# install python packages
python setup.py develop

# install javascript packages
yarn --cwd ocean_data_qc_js/ install

# launch
yarn --cwd ocean_data_qc_js/ start