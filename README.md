# Minecraft-Schema-Gen
This project is intended to analyze large amounts of JSON data, and create OpenAPI v3 schema specifications based on that data.

This project does not make any server calls, and everything is done locally.

The way it works is simply by using the `index.html` file to upload a directory of files that contain json data you want to analyze.

From there, it uses information such as the relative path, name of the file, and content of the file to generate an OpenAPI schema.

All `Post` type endpoints represent aggregated data within a specific directory.

All the `Get` type endpoints represent aggregated data within a specific directory, and all sub-directories.