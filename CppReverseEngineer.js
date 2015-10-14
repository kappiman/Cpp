/*
 * Copyright (c) 2014 MKLab. All rights reserved.
 *
 * Permission is hereby granted, free of charge, to any person obtaining a
 * copy of this software and associated documentation files (the "Software"),
 * to deal in the Software without restriction, including without limitation
 * the rights to use, copy, modify, merge, publish, distribute, sublicense,
 * and/or sell copies of the Software, and to permit persons to whom the
 * Software is furnished to do so, subject to the following conditions:
 *
 * The above copyright notice and this permission notice shall be included in
 * all copies or substantial portions of the Software.
 *
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING
 * FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER
 * DEALINGS IN THE SOFTWARE.
 *
 */

/*jslint vars: true, plusplus: true, devel: true, nomen: true, indent: 4, maxerr: 50, regexp: true, continue:true */
/*global define, $, _, window, app, type, document, cpp, parser */
define(function (require, exports, module) {
    "use strict"; 
    
    var Core            = app.getModule("core/Core"),
        Repository      = app.getModule("core/Repository"),
        ProjectManager  = app.getModule("engine/ProjectManager"),
        CommandManager  = app.getModule("command/CommandManager"),
        UML             = app.getModule("uml/UML"),
        FileSystem      = app.getModule("filesystem/FileSystem"),
        FileSystemError = app.getModule("filesystem/FileSystemError"),
        FileUtils       = app.getModule("file/FileUtils"),
        Async           = app.getModule("utils/Async");

    require("grammar/cpp");
    
    // C++ Primitive Types
    var cppPrimitiveTypes = [
        "sbyte", 
        "short",
        "ushort", 
        "uint",
        "long",
        "ulong",
        "char",
        "float",
        "double",
        "decimal",
        "bool",  
        "void",
        "auto",
        "int",
        "short int",
        "long int",
        "long long",
        "long double",
        "signed int",
        "signed char",
        "signed long",
        "signed short",
        "signed short int",
        "signed long int",
        "signed long long",
        "signed",
        "unsigned",
        "unsigned int",
        "unsigned char",
        "unsigned long",
        "unsigned short",
        "unsigned short int",
        "unsigned long int",
        "unsigned long long"
    ];
      
    /**
     * C# Code Analyzer
     * @constructor
     */
    function CppCodeAnalyzer() {

        /** @member {type.UMLModel} */
        this._root = new type.UMLModel();
        this._root.name = "CppReverse";

        /** @member {Array.<File>} */
        this._files = [];

        /** @member {Object} */
        this._currentCompilationUnit = null;

        /**
         * @member {{classifier:type.UMLClassifier, node: Object, kind:string}}
         */
        this._extendPendings = [];

        /**
         * @member {{classifier:type.UMLClassifier, node: Object}}
         */
        this._implementPendings = [];

        /**
         * @member {{classifier:type.UMLClassifier, association: type.UMLAssociation, node: Object}}
         */
        this._associationPendings = [];

        /**
         * @member {{operation:type.UMLOperation, node: Object}}
         */
        this._throwPendings = [];

        /**
         * @member {{namespace:type.UMLModelElement, feature:type.UMLStructuralFeature, node: Object}}
         */
        this._typedFeaturePendings = [];
        
        this._usingList = [];
    }
 
    /**
     * Add File to Reverse Engineer
     * @param {File} file
     */
    CppCodeAnalyzer.prototype.addFile = function (file) {
        this._files.push(file);
    };

    /**
     * Analyze all files.
     * @param {Object} options
     * @return {$.Promise}
     */
    CppCodeAnalyzer.prototype.analyze = function (options) {
        var self = this,
            promise;

        // Perform 1st Phase
        promise = this.performFirstPhase(options);

        // Perform 2nd Phase
        promise.always(function () {
            self.performSecondPhase(options);
        });

        // Load To Project
        promise.always(function () {
            var writer = new Core.Writer();
            console.log(self._root);
            writer.writeObj("data", self._root);
            var json = writer.current.data;
            ProjectManager.importFromJson(ProjectManager.getProject(), json);
        });

        // Generate Diagrams
        promise.always(function () {
            self.generateDiagrams(options);
            console.log("[C++] done.");
        });

        return promise;
    }; 
    
        /**
     * Generate Diagrams (Type Hierarchy, Package Structure, Package Overview)
     * @param {Object} options
     */
    CppCodeAnalyzer.prototype.generateDiagrams = function (options) {
        var baseModel = Repository.get(this._root._id);
        if (options.packageStructure) {
            CommandManager.execute("diagramGenerator.packageStructure", baseModel, true);
        }
        if (options.typeHierarchy) {
            CommandManager.execute("diagramGenerator.typeHierarchy", baseModel, true);
        }
        if (options.packageOverview) {
            baseModel.traverse(function (elem) {
                if (elem instanceof type.UMLPackage) {
                    CommandManager.execute("diagramGenerator.overview", elem, true);
                }
            });
        }
    };
    
    /**
     * Find Type.
     *
     * @param {type.Model} namespace
     * @param {string|Object} type Type name string or type node.
     * @param {Object} compilationUnitNode To search type with import statements.
     * @return {type.Model} element correspond to the type.
     */
    
    CppCodeAnalyzer.prototype._findType = function (namespace, type_, compilationUnitNode) {
        var typeName,
            pathName,
            _type = null;

        
        typeName = type_; 
        
        if(typeof(typeName)!= "string"){
            typeName = type_.name;   
        } 
        
        pathName = [ typeName ];

        // 1. Lookdown from context
        if (pathName.length > 1) {
            _type = namespace.lookdown(pathName);
        } else {
            _type = namespace.findByName(typeName);
        }

        // 2. Lookup from context
        if (!_type) {
            _type = namespace.lookup(typeName, null, this._root);
        }
        
        var i, len;
        // 3. Find from imported namespaces
//        if (!_type) {
//            if (compilationUnitNode.using) {
//                var i, len;
//                for (i = 0, len = compilationUnitNode.using.length; i < len; i++) {
//                    var _import = compilationUnitNode.using[i]; 
//                    // Find in import exact matches (e.g. import java.lang.String)
//                    _type = this._root.lookdown(_import.name); 
//                } 
//            }
//        }

        if (!_type) {
            for( i = 0, len=this._usingList.length; i < len; i++){
                var _import = this._usingList[i]; 
                // Find in import exact matches (e.g. import java.lang.String)
                _type = this._root.lookdown(_import.name);    
            }   
        }
        
        // 4. Lookdown from Root
        if (!_type) {
            if (pathName.length > 1) {
                _type = this._root.lookdown(pathName);
            } else {
                _type = this._root.findByName(typeName);
            }
        }
         
        return _type;
    };
    
    
      /**
     * Return the class of a given pathNames. If not exists, create the class.
     * @param {type.Model} namespace
     * @param {Array.<string>} pathNames
     * @return {type.Model} Class element corresponding to the pathNames
     */
    CppCodeAnalyzer.prototype._ensureClass = function (namespace, pathNames) {
        if (pathNames.length > 0) {
            var _className = pathNames.pop(),
                _package = this._ensurePackage(namespace, pathNames),
                _class = _package.findByName(_className);
            
            if (!_class) { 
                _class = new type.UMLClass();
                _class._parent = _package;
                _class.name = _className;
                _class.visibility = UML.VK_PUBLIC;
                _package.ownedElements.push(_class); 
            }
            
            return _class;
        }
        return null;
    };
    
    
        /**
     * Test a given type is a generic collection or not
     * @param {Object} typeNode
     * @return {string} Collection item type name
     */
    
    // _itemTypeName = this._isGenericCollection(_asso.node.type, _asso.node.compilationUnitNode);
    
    CppCodeAnalyzer.prototype._isGenericCollection = function (typeNode, compilationUnitNode) {
//        if (typeNode.qualifiedName.typeParameters && typeNode.qualifiedName.typeParameters.length > 0) {
//            var _collectionType = typeNode.qualifiedName.name,
//                _itemType       = typeNode.qualifiedName.typeParameters[0].name;
//
//            // Used Full name (e.g. java.util.List)
//            if (_.contains(javaUtilCollectionTypes, _collectionType)) {
//                return _itemType;
//            }
//
//            // Used name with imports (e.g. List and import java.util.List or java.util.*)
//            if (_.contains(javaCollectionTypes, _collectionType)) {
//                if (compilationUnitNode.imports) {
//                    var i, len;
//                    for (i = 0, len = compilationUnitNode.imports.length; i < len; i++) {
//                        var _import = compilationUnitNode.imports[i];
//
//                        // Full name import (e.g. import java.util.List)
//                        if (_import.qualifiedName.name === "java.util." + _collectionType) {
//                            return _itemType;
//                        }
//
//                        // Wildcard import (e.g. import java.util.*)
//                        if (_import.qualifiedName.name === "java.util" && _import.wildcard) {
//                            return _itemType;
//                        }
//                    }
//                }
//            }
//        }
        return null;
    };
    
       /**
     * Perform Second Phase
     *   - Create Generalizations
     *   - Create InterfaceRealizations
     *   - Create Fields or Associations
     *   - Resolve Type References
     *
     * @param {Object} options
     */
    CppCodeAnalyzer.prototype.performSecondPhase = function (options) {
        var i, len, j, len2, _typeName, _type, _itemTypeName, _itemType, _pathName;
 
        
        // Create Generalizations
        //     if super type not found, create a Class correspond to the super type.
        for (i = 0, len = this._extendPendings.length; i < len; i++) {
            var _extend = this._extendPendings[i];
            _typeName = _extend.node;
   
            _type = this._findType(_extend.classifier, _typeName, _extend.compilationUnitNode);
            
            
            if (!_type) {
//                _pathName = this._toPathName(_typeName);
                _pathName = [ _typeName ];
//                if (_extend.kind === "interface") { 
//                    _type = this._ensureInterface(this._root, _pathName);
//                } else { 
                _type = this._ensureClass(this._root, _pathName);
//                }
            } 
            
            var generalization = new type.UMLGeneralization();
            generalization._parent = _extend.classifier;
            generalization.source = _extend.classifier;
            generalization.target = _type;
            _extend.classifier.ownedElements.push(generalization);

        }  
 
        // Create Associations
        for (i = 0, len = this._associationPendings.length; i < len; i++) {
            var _asso = this._associationPendings[i];
            _typeName = _asso.node;
            _type = this._findType(_asso.classifier, _typeName, _asso.node.compilationUnitNode);
            _itemTypeName = this._isGenericCollection(_asso.node.type, _asso.node.compilationUnitNode);
            if (_itemTypeName) {
                _itemType = this._findType(_asso.classifier, _itemTypeName, _asso.node.compilationUnitNode);
            } else {
                _itemType = null;
            }

            // if type found, add as Association
            if (_type || _itemType) {
                for (j = 0, len2 = _asso.node.name.length; j < len2; j++) {
                    var variableNode = _asso.node.name[j];

                    // Create Association
                    var association = new type.UMLAssociation();
                    association._parent = _asso.classifier;
                    _asso.classifier.ownedElements.push(association);

                    // Set End1
                    association.end1.reference = _asso.classifier;
                    association.end1.name = "";
                    association.end1.visibility = UML.VK_PACKAGE;
                    association.end1.navigable = false;

                    // Set End2
                    if (_itemType) {
                        association.end2.reference = _itemType;
                        association.end2.multiplicity = "*";
                        this._addTag(association.end2, Core.TK_STRING, "collection", _asso.node.type.qualifiedName.name);
                    } else {
                        association.end2.reference = _type;
                    }
                    association.end2.name = variableNode.name;
                    association.end2.visibility = this._getVisibility(_asso.node.modifiers);
                    association.end2.navigable = true;

                    // Final Modifier
                    if (_.contains(_asso.node.modifiers, "final")) {
                        association.end2.isReadOnly = true;
                    }

                    // Static Modifier
                    if (_.contains(_asso.node.modifiers, "static")) {
                        this._addTag(association.end2, Core.TK_BOOLEAN, "static", true);
                    }

                    // Volatile Modifier
                    if (_.contains(_asso.node.modifiers, "volatile")) {
                        this._addTag(association.end2, Core.TK_BOOLEAN, "volatile", true);
                    }

                    // Transient Modifier
                    if (_.contains(_asso.node.modifiers, "transient")) {
                        this._addTag(association.end2, Core.TK_BOOLEAN, "transient", true);
                    }
                }
            // if type not found, add as Attribute
            } else {
                this.translateFieldAsAttribute(options, _asso.classifier, _asso.node);
            }
        }
         
        
        // Resolve Type References
        for (i = 0, len = this._typedFeaturePendings.length; i < len; i++) {
            var _typedFeature = this._typedFeaturePendings[i];
            _typeName = _typedFeature.node.type;

            // Find type and assign
            _type = this._findType(_typedFeature.namespace, _typedFeature.node, _typedFeature.node.compilationUnitNode);

            // if type is exists
            if (_type) {
                _typedFeature.feature.type = _type;
            // if type is not exists
            } else {
                // if type is generic collection type (e.g. java.util.List<String>)
                _itemTypeName = this._isGenericCollection(_typedFeature.node.type, _typedFeature.node.compilationUnitNode);
                if (_itemTypeName) {
                    _typeName = _itemTypeName;
                    _typedFeature.feature.multiplicity = "*";
                    this._addTag(_typedFeature.feature, Core.TK_STRING, "collection", _typedFeature.node.type);
                }

                // if type is primitive type
                if (_.contains(cppPrimitiveTypes, _typeName)) {
                    _typedFeature.feature.type = _typeName;
                // otherwise
                } else {
                    _pathName = [ _typeName ];
                    var _newClass = this._ensureClass(this._root, _pathName);
                    _typedFeature.feature.type = _newClass;
                }
            }

            // Translate type's arrayDimension to multiplicity
            if (_typedFeature.node.type && _typedFeature.node.type.length > 0) {
                var _dim = [];
                for (j = 0, len2 = _typedFeature.node.type.length; j < len2; j++) {
                    if( _typedFeature.node.type [j] == '[' ) {
                        _dim.push("*"); 
                    }
                }
                _typedFeature.feature.multiplicity = _dim.join(",");
            }
        }
    };

    
    
    /**
     * Translate C++ CompilationUnit Node.
     * @param {Object} options
     * @param {type.Model} namespace
     * @param {Object} compilationUnitNode
     */
    CppCodeAnalyzer.prototype.translateCompilationUnit = function (options, namespace, compilationUnitNode) 
    {
        var _namespace = namespace,
            i,
            len; 
        
        console.log(JSON.stringify(compilationUnitNode["member"]));
        this.translateTypes(options, _namespace, compilationUnitNode["member"]);
        
    };
      
    
    /**
     * Translate Type Nodes
     * @param {Object} options
     * @param {type.Model} namespace
     * @param {Array.<Object>} typeNodeArray
     */
    CppCodeAnalyzer.prototype.translateTypes = function (options, namespace, typeNodeArray) {
        var _namespace = namespace, i, len;
        if (typeNodeArray.length > 0) {
            for (i = 0, len = typeNodeArray.length; i < len; i++) {
                var typeNode = typeNodeArray[i];
                switch (typeNode.node) {
                case "namespace":
                    console.log("Translate namespace");
                    var _package = this.translatePackage(options, _namespace, typeNode);
                    if (_package !== null) {
                        _namespace = _package;
                    }
                    // Translate Types
                    this.translateTypes(options, _namespace, typeNode.body);
                    break;
                case "class":
                case "struct":
                    console.log("Translate struct/class");
                    this.translateClass(options, namespace, typeNode);
                    break; 
                case "enum":
                    console.log("Translate enum");
                    this.translateEnum(options, namespace, typeNode);
                    break; 
                case "using":
                    console.log("Translate using");
                    this._usingList.push(typeNode);
                    break;
                default:
                    console.log("do not parse node type: " + typeNode.node);
                    break;
                }
                
            }
        }
    };
    
    /**
     * Translate C# Enum Node.
     * @param {Object} options
     * @param {type.Model} namespace
     * @param {Object} enumNode
     */
    CppCodeAnalyzer.prototype.translateEnum = function (options, namespace, enumNode) {
        var _enum;

        // Create Enumeration
        _enum = new type.UMLEnumeration();
        _enum._parent = namespace;
        _enum.name = enumNode.name;
        _enum.visibility = this._getVisibility(enumNode.modifiers);

        // CppDoc
//        if (enumNode.comment) {
//            _enum.documentation = enumNode.comment;
//        }

        namespace.ownedElements.push(_enum);

        // Translate Type Parameters
//        this.translateTypeParameters(options, _enum, enumNode.typeParameters);
        
        if(enumNode.body != "{"){ 
            // Translate Members
            this.translateMembers(options, _enum, enumNode.body);
        }
        
    };

    
    
    /**
     * Translate C++ Class Node.
     * @param {Object} options
     * @param {type.Model} namespace
     * @param {Object} compilationUnitNode
     */
    CppCodeAnalyzer.prototype.translateClass = function (options, namespace, classNode) {
        var i, len, _class;

        // Create Class
        _class = new type.UMLClass();
        _class._parent = namespace;
        _class.name = classNode.name;

        // Access Modifiers
        _class.visibility = this._getVisibility(classNode.modifiers);

        // Abstract Class
        if (_.contains(classNode.modifiers, "abstract")) {
            _class.isAbstract = true;
        }

        // Final Class
         

        // CppDoc
//        if (classNode.comment) {
//            _class.documentation = classNode.comment;
//        }

        namespace.ownedElements.push(_class);

        // Register Extends for 2nd Phase Translation
        if (classNode["base"]) {
            for (i = 0, len = classNode["base"].length; i < len; i++) {
                var _extendPending = {
                    classifier: _class,
                    node: classNode["base"][i],
                    kind: "class",
                    compilationUnitNode: this._currentCompilationUnit
                };
                this._extendPendings.push(_extendPending);
            }
             
        } 
              
        
        // Translate Type Parameters
//        this.translateTypeParameters(options, _class, classNode.typeParameters);
        
        if(classNode.body && (classNode.body != "{") ){
            // Translate Types
            this.translateTypes(options, _class, classNode.body);
            // Translate Members
            this.translateMembers(options, _class, classNode.body); 
        }
        
        
    };
    
      /**
     * Translate Members Nodes
     * @param {Object} options
     * @param {type.Model} namespace
     * @param {Array.<Object>} memberNodeArray
     */
    CppCodeAnalyzer.prototype.translateMembers = function (options, namespace, memberNodeArray) {
        var i, len;
        if (memberNodeArray.length > 0) {
            for (i = 0, len = memberNodeArray.length; i < len; i++) {
                var memberNode = memberNodeArray[i],
                    visibility = this._getVisibility(memberNode.modifiers);

                // Generate public members only if publicOnly == true
                if (options.publicOnly && visibility !== UML.VK_PUBLIC) {
                    continue;
                }

                memberNode.compilationUnitNode = this._currentCompilationUnit;
                 
                switch (memberNode.node) {
                case "field":
                case "property":
                    if (options.association) {
                        this.translateFieldAsAssociation(options, namespace, memberNode);
                    } else {
                        this.translateFieldAsAttribute(options, namespace, memberNode);
                    }
                    break;
                case "constructor":
                    this.translateMethod(options, namespace, memberNode, true);
                    break;
                case "method":
                    this.translateMethod(options, namespace, memberNode);
                    break;
                case "constant":
//                    this.translateEnumConstant(options, namespace, memberNode);
                    break;
                }
            }
        }
    };
    
     /**
     * Translate Method
     * @param {Object} options
     * @param {type.Model} namespace
     * @param {Object} methodNode
     * @param {boolean} isConstructor
     */
    CppCodeAnalyzer.prototype.translateMethod = function (options, namespace, methodNode, isConstructor)
    {
        var i, len, _operation = new type.UMLOperation();
        _operation._parent = namespace;
        _operation.name = methodNode.name;
        
        if (!isConstructor) {
            _operation.name = methodNode.name;
        }
        
        namespace.operations.push(_operation);

        // Modifiers
        _operation.visibility = this._getVisibility(methodNode.modifiers);
        if (_.contains(methodNode.modifiers, "static")) {
            _operation.isStatic = true;
        }
        if (_.contains(methodNode.modifiers, "abstract")) {
            _operation.isAbstract = true;
        }
          

        // Constructor
        if (isConstructor) {
            _operation.stereotype = "constructor";
        }

        // Formal Parameters
        if (methodNode.parameter && methodNode.parameter.length > 0) {
            for (i = 0, len = methodNode.parameter.length; i < len; i++) {
                var parameterNode = methodNode.parameter[i];
                parameterNode.compilationUnitNode = methodNode.compilationUnitNode;
                this.translateParameter(options, _operation, parameterNode);
            }
        }

        // Return Type
        if (methodNode.type) {
            var _returnParam = new type.UMLParameter();
            _returnParam._parent = _operation;
            _returnParam.name = "";
            _returnParam.direction = UML.DK_RETURN;
            // Add to _typedFeaturePendings
            this._typedFeaturePendings.push({
                namespace: namespace,
                feature: _returnParam,
                node: methodNode
            });
            _operation.parameters.push(_returnParam);
        }

        // Throws
//        if (methodNode.throws) {
//            for (i = 0, len = methodNode.throws.length; i < len; i++) {
//                var _throwNode = methodNode.throws[i];
//                var _throwPending = {
//                    operation: _operation,
//                    node: _throwNode,
//                    compilationUnitNode: methodNode.compilationUnitNode
//                };
//                this._throwPendings.push(_throwPending);
//            }
//        }

        // CppDoc
//        if (methodNode.comment) {
//            _operation.documentation = methodNode.comment;
//        }

        // "default" for Annotation Type Element
//        if (methodNode.defaultValue) {
//            this._addTag(_operation, Core.TK_STRING, "default", methodNode.defaultValue);
//        }

        // Translate Type Parameters
//        this.translateTypeParameters(options, _operation, methodNode.typeParameters);
    };

    
       
    /**
     * Translate Method Parameters
     * @param {Object} options
     * @param {type.Model} namespace
     * @param {Object} parameterNode
     */
    
    CppCodeAnalyzer.prototype.translateParameter = function (options, namespace, parameterNode) {
        var _parameter = new type.UMLParameter();
        _parameter._parent = namespace;
        _parameter.name = parameterNode.name;
        namespace.parameters.push(_parameter);

        // Add to _typedFeaturePendings
        this._typedFeaturePendings.push({
            namespace: namespace._parent,
            feature: _parameter,
            node: parameterNode
        });
    };

    
    
    /**
     * Translate C++ Field Node as UMLAttribute.
     * @param {Object} options
     * @param {type.Model} namespace
     * @param {Object} fieldNode
     */
    
    CppCodeAnalyzer.prototype.translateFieldAsAttribute = function (options, namespace, fieldNode) 
    {
        var i, len;
        if (fieldNode.name && fieldNode.name.length > 0) {
            for (i = 0, len = fieldNode.name.length; i < len; i++) {
                var variableNode = fieldNode.name[i];

                // Create Attribute
                var _attribute = new type.UMLAttribute();
                _attribute._parent = namespace;
                _attribute.name = variableNode.name;

                // Access Modifiers
                _attribute.visibility = this._getVisibility(fieldNode.modifiers);
                if (variableNode.initialize) {
                    _attribute.defaultValue = variableNode.initialize;
                }

                // Static Modifier
                if (_.contains(fieldNode.modifiers, "static")) {
                    _attribute.isStatic = true;
                }

                // Final Modifier
                 

                // Volatile Modifier
                if (_.contains(fieldNode.modifiers, "volatile")) {
                    this._addTag(_attribute, Core.TK_BOOLEAN, "volatile", true);
                }
 
                // CsharpDoc
//                if (fieldNode.comment) {
//                    _attribute.documentation = fieldNode.comment;
//                }

                namespace.attributes.push(_attribute);

                // Add to _typedFeaturePendings
                var _typedFeature = {
                    namespace: namespace,
                    feature: _attribute,
                    node: fieldNode
                };
                this._typedFeaturePendings.push(_typedFeature);

            }
        }
    };
    
    /**
     * Add a Tag
     * @param {type.Model} elem
     * @param {string} kind Kind of Tag
     * @param {string} name
     * @param {?} value Value of Tag
     */
    CppCodeAnalyzer.prototype._addTag = function (elem, kind, name, value) {
        var tag = new type.Tag();
        tag._parent = elem;
        tag.name = name;
        tag.kind = kind;
        switch (kind) {
        case Core.TK_STRING:
            tag.value = value;
            break;
        case Core.TK_BOOLEAN:
            tag.checked = value;
            break;
        case Core.TK_NUMBER:
            tag.number = value;
            break;
        case Core.TK_REFERENCE:
            tag.reference = value;
            break;
        case Core.TK_HIDDEN:
            tag.value = value;
            break;
        }
        elem.tags.push(tag);
    };
    
    /**
     * Translate C++ Field Node as UMLAssociation.
     * @param {Object} options
     * @param {type.Model} namespace
     * @param {Object} fieldNode
     */
    
    CppCodeAnalyzer.prototype.translateFieldAsAssociation = function (options, namespace, fieldNode)  
    {
        var i, len;
        if (fieldNode.name && fieldNode.name.length > 0) {
            // Add to _associationPendings
            var _associationPending = {
                classifier: namespace,
                node: fieldNode
            };
            this._associationPendings.push(_associationPending);
        }
    };
    
     /**
     * Return visiblity from modifiers
     *
     * @param {Array.<string>} modifiers
     * @return {string} Visibility constants for UML Elements
     */
    CppCodeAnalyzer.prototype._getVisibility = function (modifiers) {
        if (_.contains(modifiers, "public")) {
            return UML.VK_PUBLIC;
        } else if (_.contains(modifiers, "protected")) {
            return UML.VK_PROTECTED;
        } else if (_.contains(modifiers, "private")) {
            return UML.VK_PRIVATE;
        }
        return UML.VK_PACKAGE;
    };

    
    
    /**
     * Translate C++ Package Node.
     * @param {Object} options
     * @param {type.Model} namespace
     * @param {Object} compilationUnitNode
     */
    CppCodeAnalyzer.prototype.translatePackage = function (options, namespace, packageNode) {
        if (packageNode && packageNode.name ) {
            
            var packageName = packageNode.name; 
            return this._ensurePackage(namespace, packageName);
        }
        return null;
    };
    
    
     /**
     * Return the package of a given packageName. If not exists, create the package.
     * @param {type.Model} namespace
     * @param {Array.<string>} packageName
     * @return {type.Model} Package element corresponding to the packageName
     */
    CppCodeAnalyzer.prototype._ensurePackage = function (namespace, packageName) {
        if (packageName.length > 0) {
            var name = packageName;
            if (name && name.length > 0) {
                var elem = namespace.findByName(name);
                if (elem !== null) {
                    // Package exists
                    return elem;
                    
                } else {
                    // Package not exists, then create one.
                    var _package = new type.UMLPackage();
                    namespace.ownedElements.push(_package);
                    _package._parent = namespace;
                    _package.name = name;
                    return _package;
                }
            }
        } else {
            return namespace;
        }
    };
    
    
    /**
     * Perform First Phase
     *   - Create Packages, Classes, Interfaces, Enums, AnnotationTypes.
     *
     * @param {Object} options
     * @return {$.Promise}
     */
    CppCodeAnalyzer.prototype.performFirstPhase = function (options) {
        var self = this;
        return Async.doSequentially(this._files, function (file) {
            var result = new $.Deferred();
            file.read({}, function (err, data, stat) {
                if (!err) {
                    try {
                        var ast = parser.parse(data);
                        
                        var results = [];
                        for (var property in ast) {
                            var value = ast[property];
                            if (value) {
                                results.push(property.toString() + ': ' + value);
                            }
                        }
                        console.log( JSON.stringify(ast) );  
                        
                        self._currentCompilationUnit = ast;
                        self._currentCompilationUnit.file = file;
                        self.translateCompilationUnit(options, self._root, ast); 
                        
                        result.resolve();
                        console.log('test');
                    } catch (ex) {
                        console.error("[C++] Failed to parse - " + file._name + "  : " + ex);
                        result.reject(ex);
                    }
                } else {
                    result.reject(err);
                }
            });
            return result.promise();
        }, false);
    };

     
     /**
     * Add File to Reverse Engineer
     * @param {File} file
     */
    CppCodeAnalyzer.prototype.addFile = function (file) {
        this._files.push(file);
    }; 
    
    
    /**
     * Analyze all C# files in basePath
     * @param {string} basePath
     * @param {Object} options
     * @return {$.Promise}
     */
    function analyze(basePath, options) {
         
        
        var result = new $.Deferred(),
            cppAnalyzer = new CppCodeAnalyzer();

        function visitEntry(entry) {
            if (entry._isFile === true) {
                var ext = FileUtils.getFileExtension(entry._path);
                if (ext && ((ext.toLowerCase() === "cpp") || (ext.toLowerCase() === "h")))
                {
                    cppAnalyzer.addFile(entry);
                }
            }
            return true;
        }

        // Traverse all file entries
        var dir = FileSystem.getDirectoryForPath(basePath);
        dir.visit(visitEntry, {}, function (err) {
            if (!err) {
                cppAnalyzer.analyze(options).then(result.resolve, result.reject);
            } else {
                result.reject(err);
            }
        });

        return result.promise();
    }

    exports.analyze = analyze;

});