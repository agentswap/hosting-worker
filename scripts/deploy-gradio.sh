#!/bin/bash

gitUrl=$1
codeDir=$2
port=$3

echo "gitUrl: $gitUrl"
echo "codeDir: $codeDir"
echo "port: $port"

# git clone --depth 1 $gitUrl $codeDir

cd $codeDir

ls -la
