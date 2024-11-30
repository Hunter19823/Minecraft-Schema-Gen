# Minecraft-Schema-Gen
This project is intended to analyze large amounts of JSON data and create OpenAPI v3 schema specifications based on that data.

# Usage:
You can easily try this out through the GitHub Pages link: 
https://hunter19823.github.io/Minecraft-Schema-Gen/

This project does not make any server calls; everything is done locally.

It works by uploading a directory of files containing JSON data you want to analyze using the `index.html` file.

From there, it uses information such as the relative path, name of the file, and content of the file to generate an OpenAPI schema.

All `Post` type endpoints represent aggregated data within a specific directory.

All the `Get` type endpoints represent aggregated data within a specific directory and all sub-directories.
