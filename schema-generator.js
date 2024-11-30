/**
 * Record the schema of a JSON value (object or array).
 * @param {object|array} jsonValue - The JSON value to analyze.
 * @returns {object} - Schema representing the structure of the JSON value.
 */
function recordSchema(jsonValue) {
    const schema = { types: {}, items: null, properties: {}, values: new Set() };

    if (Array.isArray(jsonValue)) {
        schema.types["array"] = 1;

        if (jsonValue.length > 0) {
            const itemSchemas = jsonValue.map((item) => recordSchema(item));
            schema.items = aggregateSchemas(itemSchemas);
        }
    } else if (typeof jsonValue === "object" && jsonValue !== null) {
        schema.types["object"] = 1;

        for (const [key, value] of Object.entries(jsonValue)) {
            schema.properties[key] = recordSchema(value);
        }
    } else {
        const valueType = typeof jsonValue;
        schema.types[valueType] = 1;

        if (valueType !== "object" && valueType !== "array") {
            schema.values.add(jsonValue);
        }
    }

    return schema;
}

/**
 * Aggregate schemas from multiple JSON values.
 * @param {object[]} schemas - Array of individual schemas to aggregate.
 * @returns {object} - Aggregated schema.
 */
function aggregateSchemas(schemas) {
    const aggregate = { types: {}, items: null, properties: {}, values: new Set() };

    schemas.forEach((schema) => {
        // Merge types
        for (const [type, count] of Object.entries(schema.types || {})) {
            aggregate.types[type] = (aggregate.types[type] || 0) + count;
        }

        // Merge values
        for (const value of schema.values || []) {
            aggregate.values.add(value);
        }

        // Merge properties (for objects)
        for (const [key, propSchema] of Object.entries(schema.properties || {})) {
            if (!aggregate.properties[key]) {
                aggregate.properties[key] = propSchema;
            } else {
                aggregate.properties[key] = aggregateSchemas([aggregate.properties[key], propSchema]);
            }
        }

        // Merge items (for arrays)
        if (schema.items) {
            aggregate.items = aggregate.items
                ? aggregateSchemas([aggregate.items, schema.items])
                : schema.items;
        }
    });

    // Convert sets of values to arrays for JSON compatibility
    aggregate.values = Array.from(aggregate.values);

    return aggregate;
}

/**
 * Generate an OpenAPIv3-compatible schema from the aggregated schema.
 * @param {object} aggregatedSchema - The aggregated schema.
 * @returns {object} - OpenAPIv3-compatible JSON schema.
 */
function generateOpenAPISchema(aggregatedSchema) {
    if (!aggregatedSchema) return {};

    const schema = {};
    const types = Object.keys(aggregatedSchema.types);

    if (types.length === 1) {
        schema.type = types[0];
    } else if (types.length > 1) {
        schema.oneOf = types.map((type) => ({ type }));
    }

    if (schema.type === "object" || (schema.oneOf && schema.oneOf.some((o) => o.type === "object"))) {
        schema.properties = {};
        for (const [key, propSchema] of Object.entries(aggregatedSchema.properties)) {
            schema.properties[key] = generateOpenAPISchema(propSchema);
        }
    }

    if (schema.type === "array" || (schema.oneOf && schema.oneOf.some((o) => o.type === "array"))) {
        schema.items = aggregatedSchema.items ? generateOpenAPISchema(aggregatedSchema.items) : {};
    }

    if (aggregatedSchema.values.length > 0) {
        schema.enum = aggregatedSchema.values;
    }

    return schema;
}

/**
 * Organize JSON data into a structure that links paths and names to their schemas.
 * Aggregates schemas for arrays passed as `jsonData`.
 * @param {object|array|string} jsonData - The JSON data to analyze.
 * @param {string} path - API path where the JSON data is fetched.
 * @param {string} name - Name of the JSON data.
 * @param {array[string]} tags - Schema Tags
 * @returns {object} - An object containing the schema associated with the path and name.
 */
function organizeData(jsonData, path, name, tags) {
    let schema;

    if (typeof jsonData === "string") {
        jsonData = JSON.parse(jsonData);
    }

    if (Array.isArray(jsonData)) {
        // Aggregate schemas from array elements
        const itemSchemas = jsonData.map((item) => recordSchema(item));
        schema = aggregateSchemas(itemSchemas);
    } else {
        // Record schema directly for a single object
        schema = recordSchema(jsonData);
    }

    return { schema, path, name, tags };
}

/**
 * Generate the OpenAPI spec for multiple organized JSON datasets.
 * Ensures that paths, names, and schemas are aggregated without being overridden.
 * @param {object[]} organizedData - Array of objects containing path, name, and schema.
 * @returns {object} - Final OpenAPIv3 spec.
 */
function generateOpenAPISpec(organizedData) {
    const openAPISpec = {
        openapi: "3.0.3",
        info: {
            title: "Pie's Minecraft Schema Generator",
            description: "A very simple OpenAPIv3 Spec Generator, intended for minecraft json files, applicable to other projects.",
            version: "1.0.1",
        },
        paths: {},
        components: {
            schemas: {},
        },
    };

    const aggregatedPaths = {};
    const aggregatedTags = {};
    const aggregatedSchemas = {};
    const recursiveAggregatedSchemas = {};

    organizedData.forEach(({ schema, path, name, tags }) => {
        let fullNameAndPath = `${path}`;
        if (fullNameAndPath.startsWith("/")) {
            fullNameAndPath = fullNameAndPath.substring(1);
        }

        let parents = getParentPaths(path);

        fullNameAndPath = fullNameAndPath.replaceAll("/", " ");

        // Aggregate schemas for the same name
        aggregatedSchemas[fullNameAndPath] = (!aggregatedSchemas[fullNameAndPath]) ? schema : aggregateSchemas([aggregatedSchemas[fullNameAndPath], schema]);
        
        // Aggregate tags.
        aggregatedTags[path] = (!aggregatedTags[path]) ? new Set(tags) : aggregatedTags[path].union(new Set(tags));

        // Add to paths (avoid overriding)
        if (!aggregatedPaths[path]) {
            aggregatedPaths[path] = {
                post: {
                    description: `Generated Schema for ${name}.`,
                    requestBody: {
                        content: {
                            "application/json": {
                                schema: {
                                    $ref: `#/components/schemas/${fullNameAndPath}`,
                                },
                            },
                        },
                    },
                    responses: {
                        "default": {
                            description: "placeholder",
                        },
                    }
                },
            };
        }
        
        // Add the recursive parent paths.
        for (let i=0; i<parents.length; i++) {
            let parent = parents[i];
            recursiveAggregatedSchemas[parent] = (!recursiveAggregatedSchemas[parent]) ? schema : aggregateSchemas([recursiveAggregatedSchemas[parent], schema]);

            if (!aggregatedPaths[parent]) {
                aggregatedPaths[parent] = {};
            }
            if (aggregatedPaths[parent].get) {
                continue;
            }

            aggregatedPaths[parent].get = {
                description: `Generated Recursive Schema for ${parent}.`,
                tags: [
                    "Aggregated Schemas"
                ],
                responses: {
                    "default": {
                        description: "placeholder",
                        content: {
                            "application/json": {
                                schema: {
                                    $ref: `#/components/schemas/recursive-${parent.replaceAll("/", " ")}`,
                                },
                            },
                        },
                    },
                }
            };
        }
    });

    for (const [path, spec] of Object.entries(aggregatedPaths)) {
        if (!aggregatedTags[path]) continue;
        spec.post.tags = [...aggregatedTags[path]];
    }

    // Assign paths and schemas to the final OpenAPI spec
    openAPISpec.paths = aggregatedPaths;

    for (const [fullNameAndPath, schema] of Object.entries(aggregatedSchemas)) {
        openAPISpec.components.schemas[fullNameAndPath] = generateOpenAPISchema(schema);
    }

    for (const [path, schema] of Object.entries(recursiveAggregatedSchemas)) {
        openAPISpec.components.schemas[`recursive-${path.replaceAll("/", " ")}`] = generateOpenAPISchema(schema);
    }

    return openAPISpec;
}

// Converts a string to PascalCase.
// Stolen from Stack Overflow
String.prototype.toPascalCase = function() {
    return this
        .toLowerCase()
        .replace(new RegExp(/[-_]+/, 'g'), ' ')
        .replace(new RegExp(/[^\w\s]/, 'g'), '')
        .replace(
            new RegExp(/\s+(.)(\w*)/, 'g'),
            ($1, $2, $3) => `${$2.toUpperCase() + $3}`
        )
        .replace(new RegExp(/\w/), s => s.toUpperCase());
};

function getParentPaths(path) {
    let parts = path.split("/").filter((p) => !(!p));
    let paths = ['/'];
    for (let i=0; i<parts.length; i++) {
        let currentPath = `${parts[i]}`;
        for (let j=i-1; j>=0; j--) {
            currentPath = `${parts[j]}/${currentPath}`;
        }
        paths.push(`/${currentPath}`);
    }
    return paths;
}

/**
 * Get the path to be used in the OpenAPI Path for a given file.
 * @param {File} file The file
 * @returns The Path.
 */
function getPathForFile(file) {
    if(!file.webkitRelativePath) {
        return "/";
    }
    if (!file.webkitRelativePath.includes("/")) {
        return "/";
    }

    let path = file.webkitRelativePath.split("/");
    path.pop();

    let output = path.join("/");
    if (!output.startsWith("/")) {
        output = "/"+output;
    }

    return output;
}

/**
 * Gets the name to be used for the OpenAPI Component for a given file.
 * @param {File} file the file
 * @returns The name of the file.
 */
function getNameForFile(file) {
    let shortName = file.name.substring(0, file.name.lastIndexOf('.'));
    if(!file.webkitRelativePath) {
        return shortName;
    }
    if (!file.webkitRelativePath.includes("/")) {
        return shortName;
    }

    let path = file.webkitRelativePath.split("/");
    path.pop();

    return path[path.length - 1].toPascalCase();
};

function getTagsForFile(file) {
    if(!file.webkitRelativePath) {
        return [];
    }
    if (!file.webkitRelativePath.includes("/")) {
        return [];
    }
    let path = file.webkitRelativePath.split("/");
    path.pop();
    if (path.length <= 1) {
        return path;
    }

    path.reverse();
    path.pop();
    path.reverse();

    let tags = [];
    let tag = "";
    for (let i=0; i<path.length; i++) {
        tag = path[i];
        for(let j=i-1; j>=0; j--) {
            tag = path[j] + "/" + tag;
        }
        tags.push(tag);
    }

    return tags;
}

async function waitAndMapData(promise, path, name, tags) {
    let data = await promise;
    return organizeData(data, path, name, tags);
}

/**
 * An easy to use handler for when a fileupload input changes.
 * @param {UpdateCallback} event The input update event.
 */
function onFileUploadEventHandler(event) {
    let promises = [...event.target.files]
        .filter((file) => file.type && file.type === 'application/json')
        .map((file) => [file.text(), getPathForFile(file), getNameForFile(file), getTagsForFile(file)])
        .map(([promise, path, name, tags]) => waitAndMapData(promise, path, name, tags));
    
    Promise.all(promises).then((apiData) => {
        let openAPISpec = generateOpenAPISpec(apiData);
        console.log("Generated Spec: ", openAPISpec);
        const ui = SwaggerUIBundle({
            spec: openAPISpec,
            dom_id: '#swagger-ui',
            presets: [
                SwaggerUIBundle.presets.apis,
                SwaggerUIStandalonePreset
            ]
        });
    });
}
