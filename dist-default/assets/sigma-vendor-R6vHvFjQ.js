import{r as e}from"./rolldown-runtime-hePW80VL.js";import{kr as t}from"./react-vendor-Dspsx2kC.js";import{a as n,i as r,r as i}from"./graphology-vendor-BAkBS-iK.js";var a=e(t(),1);function o(e,t){if(typeof e!=`object`||!e)return e;var n=e[Symbol.toPrimitive];if(n!==void 0){var r=n.call(e,t||`default`);if(typeof r!=`object`)return r;throw TypeError(`@@toPrimitive must return a primitive value.`)}return(t===`string`?String:Number)(e)}function s(e){var t=o(e,`string`);return typeof t==`symbol`?t:t+``}function c(e,t){if(!(e instanceof t))throw TypeError(`Cannot call a class as a function`)}function l(e,t){for(var n=0;n<t.length;n++){var r=t[n];r.enumerable=r.enumerable||!1,r.configurable=!0,`value`in r&&(r.writable=!0),Object.defineProperty(e,s(r.key),r)}}function u(e,t,n){return t&&l(e.prototype,t),n&&l(e,n),Object.defineProperty(e,"prototype",{writable:!1}),e}function d(e){return d=Object.setPrototypeOf?Object.getPrototypeOf.bind():function(e){return e.__proto__||Object.getPrototypeOf(e)},d(e)}function f(){try{var e=!Boolean.prototype.valueOf.call(Reflect.construct(Boolean,[],function(){}))}catch{}return(f=function(){return!!e})()}function p(e){if(e===void 0)throw ReferenceError(`this hasn't been initialised - super() hasn't been called`);return e}function m(e,t){if(t&&(typeof t==`object`||typeof t==`function`))return t;if(t!==void 0)throw TypeError(`Derived constructors may only return object or undefined`);return p(e)}function h(e,t,n){return t=d(t),m(e,f()?Reflect.construct(t,n||[],d(e).constructor):t.apply(e,n))}function g(e,t){return g=Object.setPrototypeOf?Object.setPrototypeOf.bind():function(e,t){return e.__proto__=t,e},g(e,t)}function _(e,t){if(typeof t!=`function`&&t!==null)throw TypeError(`Super expression must either be null or a function`);e.prototype=Object.create(t&&t.prototype,{constructor:{value:e,writable:!0,configurable:!0}}),Object.defineProperty(e,"prototype",{writable:!1}),t&&g(e,t)}function v(e){if(Array.isArray(e))return e}function y(e,t){var n=e==null?null:typeof Symbol<`u`&&e[Symbol.iterator]||e[`@@iterator`];if(n!=null){var r,i,a,o,s=[],c=!0,l=!1;try{if(a=(n=n.call(e)).next,t===0){if(Object(n)!==n)return;c=!1}else for(;!(c=(r=a.call(n)).done)&&(s.push(r.value),s.length!==t);c=!0);}catch(e){l=!0,i=e}finally{try{if(!c&&n.return!=null&&(o=n.return(),Object(o)!==o))return}finally{if(l)throw i}}return s}}function b(e,t){(t==null||t>e.length)&&(t=e.length);for(var n=0,r=Array(t);n<t;n++)r[n]=e[n];return r}function x(e,t){if(e){if(typeof e==`string`)return b(e,t);var n={}.toString.call(e).slice(8,-1);return n===`Object`&&e.constructor&&(n=e.constructor.name),n===`Map`||n===`Set`?Array.from(e):n===`Arguments`||/^(?:Ui|I)nt(?:8|16|32)(?:Clamped)?Array$/.test(n)?b(e,t):void 0}}function S(){throw TypeError(`Invalid attempt to destructure non-iterable instance.
In order to be iterable, non-array objects must have a [Symbol.iterator]() method.`)}function C(e,t){return v(e)||y(e,t)||x(e,t)||S()}var w={black:`#000000`,silver:`#C0C0C0`,gray:`#808080`,grey:`#808080`,white:`#FFFFFF`,maroon:`#800000`,red:`#FF0000`,purple:`#800080`,fuchsia:`#FF00FF`,green:`#008000`,lime:`#00FF00`,olive:`#808000`,yellow:`#FFFF00`,navy:`#000080`,blue:`#0000FF`,teal:`#008080`,aqua:`#00FFFF`,darkblue:`#00008B`,mediumblue:`#0000CD`,darkgreen:`#006400`,darkcyan:`#008B8B`,deepskyblue:`#00BFFF`,darkturquoise:`#00CED1`,mediumspringgreen:`#00FA9A`,springgreen:`#00FF7F`,cyan:`#00FFFF`,midnightblue:`#191970`,dodgerblue:`#1E90FF`,lightseagreen:`#20B2AA`,forestgreen:`#228B22`,seagreen:`#2E8B57`,darkslategray:`#2F4F4F`,darkslategrey:`#2F4F4F`,limegreen:`#32CD32`,mediumseagreen:`#3CB371`,turquoise:`#40E0D0`,royalblue:`#4169E1`,steelblue:`#4682B4`,darkslateblue:`#483D8B`,mediumturquoise:`#48D1CC`,indigo:`#4B0082`,darkolivegreen:`#556B2F`,cadetblue:`#5F9EA0`,cornflowerblue:`#6495ED`,rebeccapurple:`#663399`,mediumaquamarine:`#66CDAA`,dimgray:`#696969`,dimgrey:`#696969`,slateblue:`#6A5ACD`,olivedrab:`#6B8E23`,slategray:`#708090`,slategrey:`#708090`,lightslategray:`#778899`,lightslategrey:`#778899`,mediumslateblue:`#7B68EE`,lawngreen:`#7CFC00`,chartreuse:`#7FFF00`,aquamarine:`#7FFFD4`,skyblue:`#87CEEB`,lightskyblue:`#87CEFA`,blueviolet:`#8A2BE2`,darkred:`#8B0000`,darkmagenta:`#8B008B`,saddlebrown:`#8B4513`,darkseagreen:`#8FBC8F`,lightgreen:`#90EE90`,mediumpurple:`#9370DB`,darkviolet:`#9400D3`,palegreen:`#98FB98`,darkorchid:`#9932CC`,yellowgreen:`#9ACD32`,sienna:`#A0522D`,brown:`#A52A2A`,darkgray:`#A9A9A9`,darkgrey:`#A9A9A9`,lightblue:`#ADD8E6`,greenyellow:`#ADFF2F`,paleturquoise:`#AFEEEE`,lightsteelblue:`#B0C4DE`,powderblue:`#B0E0E6`,firebrick:`#B22222`,darkgoldenrod:`#B8860B`,mediumorchid:`#BA55D3`,rosybrown:`#BC8F8F`,darkkhaki:`#BDB76B`,mediumvioletred:`#C71585`,indianred:`#CD5C5C`,peru:`#CD853F`,chocolate:`#D2691E`,tan:`#D2B48C`,lightgray:`#D3D3D3`,lightgrey:`#D3D3D3`,thistle:`#D8BFD8`,orchid:`#DA70D6`,goldenrod:`#DAA520`,palevioletred:`#DB7093`,crimson:`#DC143C`,gainsboro:`#DCDCDC`,plum:`#DDA0DD`,burlywood:`#DEB887`,lightcyan:`#E0FFFF`,lavender:`#E6E6FA`,darksalmon:`#E9967A`,violet:`#EE82EE`,palegoldenrod:`#EEE8AA`,lightcoral:`#F08080`,khaki:`#F0E68C`,aliceblue:`#F0F8FF`,honeydew:`#F0FFF0`,azure:`#F0FFFF`,sandybrown:`#F4A460`,wheat:`#F5DEB3`,beige:`#F5F5DC`,whitesmoke:`#F5F5F5`,mintcream:`#F5FFFA`,ghostwhite:`#F8F8FF`,salmon:`#FA8072`,antiquewhite:`#FAEBD7`,linen:`#FAF0E6`,lightgoldenrodyellow:`#FAFAD2`,oldlace:`#FDF5E6`,magenta:`#FF00FF`,deeppink:`#FF1493`,orangered:`#FF4500`,tomato:`#FF6347`,hotpink:`#FF69B4`,coral:`#FF7F50`,darkorange:`#FF8C00`,lightsalmon:`#FFA07A`,orange:`#FFA500`,lightpink:`#FFB6C1`,pink:`#FFC0CB`,gold:`#FFD700`,peachpuff:`#FFDAB9`,navajowhite:`#FFDEAD`,moccasin:`#FFE4B5`,bisque:`#FFE4C4`,mistyrose:`#FFE4E1`,blanchedalmond:`#FFEBCD`,papayawhip:`#FFEFD5`,lavenderblush:`#FFF0F5`,seashell:`#FFF5EE`,cornsilk:`#FFF8DC`,lemonchiffon:`#FFFACD`,floralwhite:`#FFFAF0`,snow:`#FFFAFA`,lightyellow:`#FFFFE0`,ivory:`#FFFFF0`},T=new Int8Array(4),E=new Int32Array(T.buffer,0,1),D=new Float32Array(T.buffer,0,1),O=/^\s*rgba?\s*\(/,k=/^\s*rgba?\s*\(\s*([0-9]*)\s*,\s*([0-9]*)\s*,\s*([0-9]*)(?:\s*,\s*(.*)?)?\)\s*$/;function A(e){var t=0,n=0,r=0,i=1;if(e[0]===`#`)e.length===4?(t=parseInt(e.charAt(1)+e.charAt(1),16),n=parseInt(e.charAt(2)+e.charAt(2),16),r=parseInt(e.charAt(3)+e.charAt(3),16)):(t=parseInt(e.charAt(1)+e.charAt(2),16),n=parseInt(e.charAt(3)+e.charAt(4),16),r=parseInt(e.charAt(5)+e.charAt(6),16)),e.length===9&&(i=parseInt(e.charAt(7)+e.charAt(8),16)/255);else if(O.test(e)){var a=e.match(k);a&&(t=+a[1],n=+a[2],r=+a[3],a[4]&&(i=+a[4]))}return{r:t,g:n,b:r,a:i}}var j={};for(var M in w)j[M]=P(w[M]),j[w[M]]=j[M];function N(e,t,n,r,i){return E[0]=r<<24|n<<16|t<<8|e,i&&(E[0]&=4278190079),D[0]}function P(e){if(e=e.toLowerCase(),j[e]!==void 0)return j[e];var t=A(e),n=t.r,r=t.g,i=t.b,a=t.a;a=a*255|0;var o=N(n,r,i,a,!0);return j[e]=o,o}var F={};function I(e){if(F[e]!==void 0)return F[e];var t=N((e&16711680)>>>16,(e&65280)>>>8,e&255,255,!0);return F[e]=t,t}function ee(e,t,n,r){return n+(t<<8)+(e<<16)}function te(e,t,n,r,i,a){var o=Math.floor(n/a*i),s=Math.floor(e.drawingBufferHeight/a-r/a*i),c=new Uint8Array(4);e.bindFramebuffer(e.FRAMEBUFFER,t),e.readPixels(o,s,1,1,e.RGBA,e.UNSIGNED_BYTE,c);var l=C(c,4);return[l[0],l[1],l[2],l[3]]}function L(e,t,n){return(t=s(t))in e?Object.defineProperty(e,t,{value:n,enumerable:!0,configurable:!0,writable:!0}):e[t]=n,e}function ne(e,t){var n=Object.keys(e);if(Object.getOwnPropertySymbols){var r=Object.getOwnPropertySymbols(e);t&&(r=r.filter(function(t){return Object.getOwnPropertyDescriptor(e,t).enumerable})),n.push.apply(n,r)}return n}function R(e){for(var t=1;t<arguments.length;t++){var n=arguments[t]==null?{}:arguments[t];t%2?ne(Object(n),!0).forEach(function(t){L(e,t,n[t])}):Object.getOwnPropertyDescriptors?Object.defineProperties(e,Object.getOwnPropertyDescriptors(n)):ne(Object(n)).forEach(function(t){Object.defineProperty(e,t,Object.getOwnPropertyDescriptor(n,t))})}return e}function re(e,t){for(;!{}.hasOwnProperty.call(e,t)&&(e=d(e))!==null;);return e}function z(){return z=typeof Reflect<`u`&&Reflect.get?Reflect.get.bind():function(e,t,n){var r=re(e,t);if(r){var i=Object.getOwnPropertyDescriptor(r,t);return i.get?i.get.call(arguments.length<3?e:n):i.value}},z.apply(null,arguments)}function B(e,t,n,r){var i=z(d(1&r?e.prototype:e),t,n);return 2&r&&typeof i==`function`?function(e){return i.apply(n,e)}:i}function ie(e){return e.normalized?1:e.size}function V(e){var t=0;return e.forEach(function(e){return t+=ie(e)}),t}function ae(e,t,n){var r=e===`VERTEX`?t.VERTEX_SHADER:t.FRAGMENT_SHADER,i=t.createShader(r);if(i===null)throw Error(`loadShader: error while creating the shader`);if(t.shaderSource(i,n),t.compileShader(i),!t.getShaderParameter(i,t.COMPILE_STATUS)){var a=t.getShaderInfoLog(i);throw t.deleteShader(i),Error(`loadShader: error while compiling the shader:
${a}
${n}`)}return i}function oe(e,t){return ae(`VERTEX`,e,t)}function se(e,t){return ae(`FRAGMENT`,e,t)}function ce(e,t){var n=e.createProgram();if(n===null)throw Error(`loadProgram: error while creating the program.`);var r,i;for(r=0,i=t.length;r<i;r++)e.attachShader(n,t[r]);if(e.linkProgram(n),!e.getProgramParameter(n,e.LINK_STATUS)){var a=e.getProgramInfoLog(n);throw e.deleteProgram(n),Error(`loadProgram: error while linking the program: ${a}`)}return n}function le(e){var t=e.gl,n=e.buffer,r=e.program,i=e.vertexShader,a=e.fragmentShader;t.deleteShader(i),t.deleteShader(a),t.deleteProgram(r),t.deleteBuffer(n)}var ue=`#define PICKING_MODE
`,de=L(L(L(L(L(L(L(L({},WebGL2RenderingContext.BOOL,1),WebGL2RenderingContext.BYTE,1),WebGL2RenderingContext.UNSIGNED_BYTE,1),WebGL2RenderingContext.SHORT,2),WebGL2RenderingContext.UNSIGNED_SHORT,2),WebGL2RenderingContext.INT,4),WebGL2RenderingContext.UNSIGNED_INT,4),WebGL2RenderingContext.FLOAT,4),fe=function(){function e(t,n,r){c(this,e),L(this,`array`,new Float32Array),L(this,`constantArray`,new Float32Array),L(this,`capacity`,0),L(this,`verticesCount`,0);var i=this.getDefinition();if(this.VERTICES=i.VERTICES,this.VERTEX_SHADER_SOURCE=i.VERTEX_SHADER_SOURCE,this.FRAGMENT_SHADER_SOURCE=i.FRAGMENT_SHADER_SOURCE,this.UNIFORMS=i.UNIFORMS,this.ATTRIBUTES=i.ATTRIBUTES,this.METHOD=i.METHOD,this.CONSTANT_ATTRIBUTES=`CONSTANT_ATTRIBUTES`in i?i.CONSTANT_ATTRIBUTES:[],this.CONSTANT_DATA=`CONSTANT_DATA`in i?i.CONSTANT_DATA:[],this.isInstanced=`CONSTANT_ATTRIBUTES`in i,this.ATTRIBUTES_ITEMS_COUNT=V(this.ATTRIBUTES),this.STRIDE=this.VERTICES*this.ATTRIBUTES_ITEMS_COUNT,this.renderer=r,this.normalProgram=this.getProgramInfo(`normal`,t,i.VERTEX_SHADER_SOURCE,i.FRAGMENT_SHADER_SOURCE,null),this.pickProgram=n?this.getProgramInfo(`pick`,t,ue+i.VERTEX_SHADER_SOURCE,ue+i.FRAGMENT_SHADER_SOURCE,n):null,this.isInstanced){var a=V(this.CONSTANT_ATTRIBUTES);if(this.CONSTANT_DATA.length!==this.VERTICES)throw Error(`Program: error while getting constant data (expected ${this.VERTICES} items, received ${this.CONSTANT_DATA.length} instead)`);this.constantArray=new Float32Array(this.CONSTANT_DATA.length*a);for(var o=0;o<this.CONSTANT_DATA.length;o++){var s=this.CONSTANT_DATA[o];if(s.length!==a)throw Error(`Program: error while getting constant data (one vector has ${s.length} items instead of ${a})`);for(var l=0;l<s.length;l++)this.constantArray[o*a+l]=s[l]}this.STRIDE=this.ATTRIBUTES_ITEMS_COUNT}}return u(e,[{key:`kill`,value:function(){le(this.normalProgram),this.pickProgram&&=(le(this.pickProgram),null)}},{key:`getProgramInfo`,value:function(e,t,n,r,i){var a=this.getDefinition(),o=t.createBuffer();if(o===null)throw Error(`Program: error while creating the WebGL buffer.`);var s=oe(t,n),c=se(t,r),l=ce(t,[s,c]),u={};a.UNIFORMS.forEach(function(e){var n=t.getUniformLocation(l,e);n&&(u[e]=n)});var d={};a.ATTRIBUTES.forEach(function(e){d[e.name]=t.getAttribLocation(l,e.name)});var f;if(`CONSTANT_ATTRIBUTES`in a&&(a.CONSTANT_ATTRIBUTES.forEach(function(e){d[e.name]=t.getAttribLocation(l,e.name)}),f=t.createBuffer(),f===null))throw Error(`Program: error while creating the WebGL constant buffer.`);return{name:e,program:l,gl:t,frameBuffer:i,buffer:o,constantBuffer:f||{},uniformLocations:u,attributeLocations:d,isPicking:e===`pick`,vertexShader:s,fragmentShader:c}}},{key:`bindProgram`,value:function(e){var t=this,n=0,r=e.gl,i=e.buffer;this.isInstanced?(r.bindBuffer(r.ARRAY_BUFFER,e.constantBuffer),n=0,this.CONSTANT_ATTRIBUTES.forEach(function(r){return n+=t.bindAttribute(r,e,n,!1)}),r.bufferData(r.ARRAY_BUFFER,this.constantArray,r.STATIC_DRAW),r.bindBuffer(r.ARRAY_BUFFER,e.buffer),n=0,this.ATTRIBUTES.forEach(function(r){return n+=t.bindAttribute(r,e,n,!0)}),r.bufferData(r.ARRAY_BUFFER,this.array,r.DYNAMIC_DRAW)):(r.bindBuffer(r.ARRAY_BUFFER,i),n=0,this.ATTRIBUTES.forEach(function(r){return n+=t.bindAttribute(r,e,n)}),r.bufferData(r.ARRAY_BUFFER,this.array,r.DYNAMIC_DRAW)),r.bindBuffer(r.ARRAY_BUFFER,null)}},{key:`unbindProgram`,value:function(e){var t=this;this.isInstanced?(this.CONSTANT_ATTRIBUTES.forEach(function(n){return t.unbindAttribute(n,e,!1)}),this.ATTRIBUTES.forEach(function(n){return t.unbindAttribute(n,e,!0)})):this.ATTRIBUTES.forEach(function(n){return t.unbindAttribute(n,e)})}},{key:`bindAttribute`,value:function(e,t,n,r){var i=de[e.type];if(typeof i!=`number`)throw Error(`Program.bind: yet unsupported attribute type "${e.type}"`);var a=t.attributeLocations[e.name],o=t.gl;if(a!==-1){o.enableVertexAttribArray(a);var s=this.isInstanced?(r?this.ATTRIBUTES_ITEMS_COUNT:V(this.CONSTANT_ATTRIBUTES))*Float32Array.BYTES_PER_ELEMENT:this.ATTRIBUTES_ITEMS_COUNT*Float32Array.BYTES_PER_ELEMENT;if(o.vertexAttribPointer(a,e.size,e.type,e.normalized||!1,s,n),this.isInstanced&&r){if(o instanceof WebGL2RenderingContext)o.vertexAttribDivisor(a,1);else{var c=o.getExtension(`ANGLE_instanced_arrays`);c&&c.vertexAttribDivisorANGLE(a,1)}}}return e.size*i}},{key:`unbindAttribute`,value:function(e,t,n){var r=t.attributeLocations[e.name],i=t.gl;if(r!==-1&&(i.disableVertexAttribArray(r),this.isInstanced&&n)){if(i instanceof WebGL2RenderingContext)i.vertexAttribDivisor(r,0);else{var a=i.getExtension(`ANGLE_instanced_arrays`);a&&a.vertexAttribDivisorANGLE(r,0)}}}},{key:`reallocate`,value:function(e){e!==this.capacity&&(this.capacity=e,this.verticesCount=this.VERTICES*e,this.array=new Float32Array(this.isInstanced?this.capacity*this.ATTRIBUTES_ITEMS_COUNT:this.verticesCount*this.ATTRIBUTES_ITEMS_COUNT))}},{key:`hasNothingToRender`,value:function(){return this.verticesCount===0}},{key:`renderProgram`,value:function(e,t){var n=t.gl,r=t.program;n.enable(n.BLEND),n.useProgram(r),this.setUniforms(e,t),this.drawWebGL(this.METHOD,t)}},{key:`render`,value:function(e){this.hasNothingToRender()||(this.pickProgram&&(this.pickProgram.gl.viewport(0,0,e.width*e.pixelRatio/e.downSizingRatio,e.height*e.pixelRatio/e.downSizingRatio),this.bindProgram(this.pickProgram),this.renderProgram(R(R({},e),{},{pixelRatio:e.pixelRatio/e.downSizingRatio}),this.pickProgram),this.unbindProgram(this.pickProgram)),this.normalProgram.gl.viewport(0,0,e.width*e.pixelRatio,e.height*e.pixelRatio),this.bindProgram(this.normalProgram),this.renderProgram(e,this.normalProgram),this.unbindProgram(this.normalProgram))}},{key:`drawWebGL`,value:function(e,t){var n=t.gl,r=t.frameBuffer;if(n.bindFramebuffer(n.FRAMEBUFFER,r),!this.isInstanced)n.drawArrays(e,0,this.verticesCount);else if(n instanceof WebGL2RenderingContext)n.drawArraysInstanced(e,0,this.VERTICES,this.capacity);else{var i=n.getExtension(`ANGLE_instanced_arrays`);i&&i.drawArraysInstancedANGLE(e,0,this.VERTICES,this.capacity)}}}])}(),pe=function(e){function t(){return c(this,t),h(this,t,arguments)}return _(t,e),u(t,[{key:`kill`,value:function(){B(t,`kill`,this,3)([])}},{key:`process`,value:function(e,t,n){var r=t*this.STRIDE;if(n.hidden){for(var i=r+this.STRIDE;r<i;r++)this.array[r]=0;return}return this.processVisibleItem(I(e),r,n)}}])}(fe),H=function(e){function t(){var e;c(this,t);var n=[...arguments];return e=h(this,t,[].concat(n)),L(e,`drawLabel`,void 0),e}return _(t,e),u(t,[{key:`kill`,value:function(){B(t,`kill`,this,3)([])}},{key:`process`,value:function(e,t,n,r,i){var a=t*this.STRIDE;if(i.hidden||n.hidden||r.hidden){for(var o=a+this.STRIDE;a<o;a++)this.array[a]=0;return}return this.processVisibleItem(I(e),a,n,r,i)}}])}(fe);function me(e,t){return function(){function n(r,i,a){c(this,n),L(this,`drawLabel`,t),this.programs=e.map(function(e){return new e(r,i,a)})}return u(n,[{key:`reallocate`,value:function(e){this.programs.forEach(function(t){return t.reallocate(e)})}},{key:`process`,value:function(e,t,n,r,i){this.programs.forEach(function(a){return a.process(e,t,n,r,i)})}},{key:`render`,value:function(e){this.programs.forEach(function(t){return t.render(e)})}},{key:`kill`,value:function(){this.programs.forEach(function(e){return e.kill()})}}])}()}function he(e,t,n,r,i){var a=i.edgeLabelSize,o=i.edgeLabelFont,s=i.edgeLabelWeight,c=i.edgeLabelColor.attribute?t[i.edgeLabelColor.attribute]||i.edgeLabelColor.color||`#000`:i.edgeLabelColor.color,l=t.label;if(l){e.fillStyle=c,e.font=`${s} ${a}px ${o}`;var u=n.size,d=r.size,f=n.x,p=n.y,m=r.x,h=r.y,g=(f+m)/2,_=(p+h)/2,v=m-f,y=h-p,b=Math.sqrt(v*v+y*y);if(!(b<u+d)){f+=v*u/b,p+=y*u/b,m-=v*d/b,h-=y*d/b,g=(f+m)/2,_=(p+h)/2,v=m-f,y=h-p,b=Math.sqrt(v*v+y*y);var x=e.measureText(l).width;if(x>b){var S=`…`;for(l+=S,x=e.measureText(l).width;x>b&&l.length>1;)l=l.slice(0,-2)+S,x=e.measureText(l).width;if(l.length<4)return}var C=v>0?y>0?Math.acos(v/b):Math.asin(y/b):y>0?Math.acos(v/b)+Math.PI:Math.asin(v/b)+Math.PI/2;e.save(),e.translate(g,_),e.rotate(C),e.fillText(l,-x/2,t.size/2+a),e.restore()}}}function ge(e,t,n){if(t.label){var r=n.labelSize,i=n.labelFont,a=n.labelWeight;e.fillStyle=n.labelColor.attribute?t[n.labelColor.attribute]||n.labelColor.color||`#000`:n.labelColor.color,e.font=`${a} ${r}px ${i}`,e.fillText(t.label,t.x+t.size+3,t.y+r/3)}}function _e(e,t,n){var r=n.labelSize,i=n.labelFont;e.font=`${n.labelWeight} ${r}px ${i}`,e.fillStyle=`#FFF`,e.shadowOffsetX=0,e.shadowOffsetY=0,e.shadowBlur=8,e.shadowColor=`#000`;var a=2;if(typeof t.label==`string`){var o=e.measureText(t.label).width,s=Math.round(o+5),c=Math.round(r+2*a),l=Math.max(t.size,r/2)+a,u=Math.asin(c/2/l),d=Math.sqrt(Math.abs(l**2-(c/2)**2));e.beginPath(),e.moveTo(t.x+d,t.y+c/2),e.lineTo(t.x+l+s,t.y+c/2),e.lineTo(t.x+l+s,t.y-c/2),e.lineTo(t.x+d,t.y-c/2),e.arc(t.x,t.y,l,u,-u),e.closePath(),e.fill()}else e.beginPath(),e.arc(t.x,t.y,t.size+a,0,Math.PI*2),e.closePath(),e.fill();e.shadowOffsetX=0,e.shadowOffsetY=0,e.shadowBlur=0,ge(e,t,n)}var ve=`
precision highp float;

varying vec4 v_color;
varying vec2 v_diffVector;
varying float v_radius;

uniform float u_correctionRatio;

const vec4 transparent = vec4(0.0, 0.0, 0.0, 0.0);

void main(void) {
  float border = u_correctionRatio * 2.0;
  float dist = length(v_diffVector) - v_radius + border;

  // No antialiasing for picking mode:
  #ifdef PICKING_MODE
  if (dist > border)
    gl_FragColor = transparent;
  else
    gl_FragColor = v_color;

  #else
  float t = 0.0;
  if (dist > border)
    t = 1.0;
  else if (dist > 0.0)
    t = dist / border;

  gl_FragColor = mix(v_color, transparent, t);
  #endif
}
`,ye=`
attribute vec4 a_id;
attribute vec4 a_color;
attribute vec2 a_position;
attribute float a_size;
attribute float a_angle;

uniform mat3 u_matrix;
uniform float u_sizeRatio;
uniform float u_correctionRatio;

varying vec4 v_color;
varying vec2 v_diffVector;
varying float v_radius;
varying float v_border;

const float bias = 255.0 / 254.0;

void main() {
  float size = a_size * u_correctionRatio / u_sizeRatio * 4.0;
  vec2 diffVector = size * vec2(cos(a_angle), sin(a_angle));
  vec2 position = a_position + diffVector;
  gl_Position = vec4(
    (u_matrix * vec3(position, 1)).xy,
    0,
    1
  );

  v_diffVector = diffVector;
  v_radius = size / 2.0;

  #ifdef PICKING_MODE
  // For picking mode, we use the ID as the color:
  v_color = a_id;
  #else
  // For normal mode, we use the color:
  v_color = a_color;
  #endif

  v_color.a *= bias;
}
`,be=WebGLRenderingContext,xe=be.UNSIGNED_BYTE,Se=be.FLOAT,Ce=[`u_sizeRatio`,`u_correctionRatio`,`u_matrix`],we=function(e){function t(){return c(this,t),h(this,t,arguments)}return _(t,e),u(t,[{key:`getDefinition`,value:function(){return{VERTICES:3,VERTEX_SHADER_SOURCE:ye,FRAGMENT_SHADER_SOURCE:ve,METHOD:WebGLRenderingContext.TRIANGLES,UNIFORMS:Ce,ATTRIBUTES:[{name:`a_position`,size:2,type:Se},{name:`a_size`,size:1,type:Se},{name:`a_color`,size:4,type:xe,normalized:!0},{name:`a_id`,size:4,type:xe,normalized:!0}],CONSTANT_ATTRIBUTES:[{name:`a_angle`,size:1,type:Se}],CONSTANT_DATA:[[t.ANGLE_1],[t.ANGLE_2],[t.ANGLE_3]]}}},{key:`processVisibleItem`,value:function(e,t,n){var r=this.array,i=P(n.color);r[t++]=n.x,r[t++]=n.y,r[t++]=n.size,r[t++]=i,r[t++]=e}},{key:`setUniforms`,value:function(e,t){var n=t.gl,r=t.uniformLocations,i=r.u_sizeRatio,a=r.u_correctionRatio,o=r.u_matrix;n.uniform1f(a,e.correctionRatio),n.uniform1f(i,e.sizeRatio),n.uniformMatrix3fv(o,!1,e.matrix)}}])}(pe);L(we,`ANGLE_1`,0),L(we,`ANGLE_2`,2*Math.PI/3),L(we,`ANGLE_3`,4*Math.PI/3);var Te=`
precision mediump float;

varying vec4 v_color;

void main(void) {
  gl_FragColor = v_color;
}
`,Ee=`
attribute vec2 a_position;
attribute vec2 a_normal;
attribute float a_radius;
attribute vec3 a_barycentric;

#ifdef PICKING_MODE
attribute vec4 a_id;
#else
attribute vec4 a_color;
#endif

uniform mat3 u_matrix;
uniform float u_sizeRatio;
uniform float u_correctionRatio;
uniform float u_minEdgeThickness;
uniform float u_lengthToThicknessRatio;
uniform float u_widenessToThicknessRatio;

varying vec4 v_color;

const float bias = 255.0 / 254.0;

void main() {
  float minThickness = u_minEdgeThickness;

  float normalLength = length(a_normal);
  vec2 unitNormal = a_normal / normalLength;

  // These first computations are taken from edge.vert.glsl and
  // edge.clamped.vert.glsl. Please read it to get better comments on what's
  // happening:
  float pixelsThickness = max(normalLength / u_sizeRatio, minThickness);
  float webGLThickness = pixelsThickness * u_correctionRatio;
  float webGLNodeRadius = a_radius * 2.0 * u_correctionRatio / u_sizeRatio;
  float webGLArrowHeadLength = webGLThickness * u_lengthToThicknessRatio * 2.0;
  float webGLArrowHeadThickness = webGLThickness * u_widenessToThicknessRatio;

  float da = a_barycentric.x;
  float db = a_barycentric.y;
  float dc = a_barycentric.z;

  vec2 delta = vec2(
      da * (webGLNodeRadius * unitNormal.y)
    + db * ((webGLNodeRadius + webGLArrowHeadLength) * unitNormal.y + webGLArrowHeadThickness * unitNormal.x)
    + dc * ((webGLNodeRadius + webGLArrowHeadLength) * unitNormal.y - webGLArrowHeadThickness * unitNormal.x),

      da * (-webGLNodeRadius * unitNormal.x)
    + db * (-(webGLNodeRadius + webGLArrowHeadLength) * unitNormal.x + webGLArrowHeadThickness * unitNormal.y)
    + dc * (-(webGLNodeRadius + webGLArrowHeadLength) * unitNormal.x - webGLArrowHeadThickness * unitNormal.y)
  );

  vec2 position = (u_matrix * vec3(a_position + delta, 1)).xy;

  gl_Position = vec4(position, 0, 1);

  #ifdef PICKING_MODE
  // For picking mode, we use the ID as the color:
  v_color = a_id;
  #else
  // For normal mode, we use the color:
  v_color = a_color;
  #endif

  v_color.a *= bias;
}
`,De=WebGLRenderingContext,Oe=De.UNSIGNED_BYTE,ke=De.FLOAT,Ae=[`u_matrix`,`u_sizeRatio`,`u_correctionRatio`,`u_minEdgeThickness`,`u_lengthToThicknessRatio`,`u_widenessToThicknessRatio`],U={extremity:`target`,lengthToThicknessRatio:2.5,widenessToThicknessRatio:2};function je(e){var t=R(R({},U),e||{});return function(e){function n(){return c(this,n),h(this,n,arguments)}return _(n,e),u(n,[{key:`getDefinition`,value:function(){return{VERTICES:3,VERTEX_SHADER_SOURCE:Ee,FRAGMENT_SHADER_SOURCE:Te,METHOD:WebGLRenderingContext.TRIANGLES,UNIFORMS:Ae,ATTRIBUTES:[{name:`a_position`,size:2,type:ke},{name:`a_normal`,size:2,type:ke},{name:`a_radius`,size:1,type:ke},{name:`a_color`,size:4,type:Oe,normalized:!0},{name:`a_id`,size:4,type:Oe,normalized:!0}],CONSTANT_ATTRIBUTES:[{name:`a_barycentric`,size:3,type:ke}],CONSTANT_DATA:[[1,0,0],[0,1,0],[0,0,1]]}}},{key:`processVisibleItem`,value:function(e,n,r,i,a){if(t.extremity===`source`){var o=[i,r];r=o[0],i=o[1]}var s=a.size||1,c=i.size||1,l=r.x,u=r.y,d=i.x,f=i.y,p=P(a.color),m=d-l,h=f-u,g=m*m+h*h,_=0,v=0;g&&(g=1/Math.sqrt(g),_=-h*g*s,v=m*g*s);var y=this.array;y[n++]=d,y[n++]=f,y[n++]=-_,y[n++]=-v,y[n++]=c,y[n++]=p,y[n++]=e}},{key:`setUniforms`,value:function(e,n){var r=n.gl,i=n.uniformLocations,a=i.u_matrix,o=i.u_sizeRatio,s=i.u_correctionRatio,c=i.u_minEdgeThickness,l=i.u_lengthToThicknessRatio,u=i.u_widenessToThicknessRatio;r.uniformMatrix3fv(a,!1,e.matrix),r.uniform1f(o,e.sizeRatio),r.uniform1f(s,e.correctionRatio),r.uniform1f(c,e.minEdgeThickness),r.uniform1f(l,t.lengthToThicknessRatio),r.uniform1f(u,t.widenessToThicknessRatio)}}])}(H)}je();var Me=`
precision mediump float;

varying vec4 v_color;
varying vec2 v_normal;
varying float v_thickness;
varying float v_feather;

const vec4 transparent = vec4(0.0, 0.0, 0.0, 0.0);

void main(void) {
  // We only handle antialiasing for normal mode:
  #ifdef PICKING_MODE
  gl_FragColor = v_color;
  #else
  float dist = length(v_normal) * v_thickness;

  float t = smoothstep(
    v_thickness - v_feather,
    v_thickness,
    dist
  );

  gl_FragColor = mix(v_color, transparent, t);
  #endif
}
`,Ne=`
attribute vec4 a_id;
attribute vec4 a_color;
attribute vec2 a_normal;
attribute float a_normalCoef;
attribute vec2 a_positionStart;
attribute vec2 a_positionEnd;
attribute float a_positionCoef;
attribute float a_radius;
attribute float a_radiusCoef;

uniform mat3 u_matrix;
uniform float u_zoomRatio;
uniform float u_sizeRatio;
uniform float u_pixelRatio;
uniform float u_correctionRatio;
uniform float u_minEdgeThickness;
uniform float u_lengthToThicknessRatio;
uniform float u_feather;

varying vec4 v_color;
varying vec2 v_normal;
varying float v_thickness;
varying float v_feather;

const float bias = 255.0 / 254.0;

void main() {
  float minThickness = u_minEdgeThickness;

  float radius = a_radius * a_radiusCoef;
  vec2 normal = a_normal * a_normalCoef;
  vec2 position = a_positionStart * (1.0 - a_positionCoef) + a_positionEnd * a_positionCoef;

  float normalLength = length(normal);
  vec2 unitNormal = normal / normalLength;

  // These first computations are taken from edge.vert.glsl. Please read it to
  // get better comments on what's happening:
  float pixelsThickness = max(normalLength, minThickness * u_sizeRatio);
  float webGLThickness = pixelsThickness * u_correctionRatio / u_sizeRatio;

  // Here, we move the point to leave space for the arrow head:
  float direction = sign(radius);
  float webGLNodeRadius = direction * radius * 2.0 * u_correctionRatio / u_sizeRatio;
  float webGLArrowHeadLength = webGLThickness * u_lengthToThicknessRatio * 2.0;

  vec2 compensationVector = vec2(-direction * unitNormal.y, direction * unitNormal.x) * (webGLNodeRadius + webGLArrowHeadLength);

  // Here is the proper position of the vertex
  gl_Position = vec4((u_matrix * vec3(position + unitNormal * webGLThickness + compensationVector, 1)).xy, 0, 1);

  v_thickness = webGLThickness / u_zoomRatio;

  v_normal = unitNormal;

  v_feather = u_feather * u_correctionRatio / u_zoomRatio / u_pixelRatio * 2.0;

  #ifdef PICKING_MODE
  // For picking mode, we use the ID as the color:
  v_color = a_id;
  #else
  // For normal mode, we use the color:
  v_color = a_color;
  #endif

  v_color.a *= bias;
}
`,Pe=WebGLRenderingContext,Fe=Pe.UNSIGNED_BYTE,W=Pe.FLOAT,Ie=[`u_matrix`,`u_zoomRatio`,`u_sizeRatio`,`u_correctionRatio`,`u_pixelRatio`,`u_feather`,`u_minEdgeThickness`,`u_lengthToThicknessRatio`],Le={lengthToThicknessRatio:U.lengthToThicknessRatio};function Re(e){var t=R(R({},Le),e||{});return function(e){function n(){return c(this,n),h(this,n,arguments)}return _(n,e),u(n,[{key:`getDefinition`,value:function(){return{VERTICES:6,VERTEX_SHADER_SOURCE:Ne,FRAGMENT_SHADER_SOURCE:Me,METHOD:WebGLRenderingContext.TRIANGLES,UNIFORMS:Ie,ATTRIBUTES:[{name:`a_positionStart`,size:2,type:W},{name:`a_positionEnd`,size:2,type:W},{name:`a_normal`,size:2,type:W},{name:`a_color`,size:4,type:Fe,normalized:!0},{name:`a_id`,size:4,type:Fe,normalized:!0},{name:`a_radius`,size:1,type:W}],CONSTANT_ATTRIBUTES:[{name:`a_positionCoef`,size:1,type:W},{name:`a_normalCoef`,size:1,type:W},{name:`a_radiusCoef`,size:1,type:W}],CONSTANT_DATA:[[0,1,0],[0,-1,0],[1,1,1],[1,1,1],[0,-1,0],[1,-1,-1]]}}},{key:`processVisibleItem`,value:function(e,t,n,r,i){var a=i.size||1,o=n.x,s=n.y,c=r.x,l=r.y,u=P(i.color),d=c-o,f=l-s,p=r.size||1,m=d*d+f*f,h=0,g=0;m&&(m=1/Math.sqrt(m),h=-f*m*a,g=d*m*a);var _=this.array;_[t++]=o,_[t++]=s,_[t++]=c,_[t++]=l,_[t++]=h,_[t++]=g,_[t++]=u,_[t++]=e,_[t++]=p}},{key:`setUniforms`,value:function(e,n){var r=n.gl,i=n.uniformLocations,a=i.u_matrix,o=i.u_zoomRatio,s=i.u_feather,c=i.u_pixelRatio,l=i.u_correctionRatio,u=i.u_sizeRatio,d=i.u_minEdgeThickness,f=i.u_lengthToThicknessRatio;r.uniformMatrix3fv(a,!1,e.matrix),r.uniform1f(o,e.zoomRatio),r.uniform1f(u,e.sizeRatio),r.uniform1f(l,e.correctionRatio),r.uniform1f(c,e.pixelRatio),r.uniform1f(s,e.antiAliasingFeather),r.uniform1f(d,e.minEdgeThickness),r.uniform1f(f,t.lengthToThicknessRatio)}}])}(H)}var ze=Re();function Be(e){return me([Re(e),je(e)])}var Ve=Be(),He=`
attribute vec4 a_id;
attribute vec4 a_color;
attribute vec2 a_normal;
attribute float a_normalCoef;
attribute vec2 a_positionStart;
attribute vec2 a_positionEnd;
attribute float a_positionCoef;

uniform mat3 u_matrix;
uniform float u_sizeRatio;
uniform float u_zoomRatio;
uniform float u_pixelRatio;
uniform float u_correctionRatio;
uniform float u_minEdgeThickness;
uniform float u_feather;

varying vec4 v_color;
varying vec2 v_normal;
varying float v_thickness;
varying float v_feather;

const float bias = 255.0 / 254.0;

void main() {
  float minThickness = u_minEdgeThickness;

  vec2 normal = a_normal * a_normalCoef;
  vec2 position = a_positionStart * (1.0 - a_positionCoef) + a_positionEnd * a_positionCoef;

  float normalLength = length(normal);
  vec2 unitNormal = normal / normalLength;

  // We require edges to be at least "minThickness" pixels thick *on screen*
  // (so we need to compensate the size ratio):
  float pixelsThickness = max(normalLength, minThickness * u_sizeRatio);

  // Then, we need to retrieve the normalized thickness of the edge in the WebGL
  // referential (in a ([0, 1], [0, 1]) space), using our "magic" correction
  // ratio:
  float webGLThickness = pixelsThickness * u_correctionRatio / u_sizeRatio;

  // Here is the proper position of the vertex
  gl_Position = vec4((u_matrix * vec3(position + unitNormal * webGLThickness, 1)).xy, 0, 1);

  // For the fragment shader though, we need a thickness that takes the "magic"
  // correction ratio into account (as in webGLThickness), but so that the
  // antialiasing effect does not depend on the zoom level. So here's yet
  // another thickness version:
  v_thickness = webGLThickness / u_zoomRatio;

  v_normal = unitNormal;

  v_feather = u_feather * u_correctionRatio / u_zoomRatio / u_pixelRatio * 2.0;

  #ifdef PICKING_MODE
  // For picking mode, we use the ID as the color:
  v_color = a_id;
  #else
  // For normal mode, we use the color:
  v_color = a_color;
  #endif

  v_color.a *= bias;
}
`,Ue=WebGLRenderingContext,We=Ue.UNSIGNED_BYTE,G=Ue.FLOAT,Ge=[`u_matrix`,`u_zoomRatio`,`u_sizeRatio`,`u_correctionRatio`,`u_pixelRatio`,`u_feather`,`u_minEdgeThickness`],Ke=function(e){function t(){return c(this,t),h(this,t,arguments)}return _(t,e),u(t,[{key:`getDefinition`,value:function(){return{VERTICES:6,VERTEX_SHADER_SOURCE:He,FRAGMENT_SHADER_SOURCE:Me,METHOD:WebGLRenderingContext.TRIANGLES,UNIFORMS:Ge,ATTRIBUTES:[{name:`a_positionStart`,size:2,type:G},{name:`a_positionEnd`,size:2,type:G},{name:`a_normal`,size:2,type:G},{name:`a_color`,size:4,type:We,normalized:!0},{name:`a_id`,size:4,type:We,normalized:!0}],CONSTANT_ATTRIBUTES:[{name:`a_positionCoef`,size:1,type:G},{name:`a_normalCoef`,size:1,type:G}],CONSTANT_DATA:[[0,1],[0,-1],[1,1],[1,1],[0,-1],[1,-1]]}}},{key:`processVisibleItem`,value:function(e,t,n,r,i){var a=i.size||1,o=n.x,s=n.y,c=r.x,l=r.y,u=P(i.color),d=c-o,f=l-s,p=d*d+f*f,m=0,h=0;p&&(p=1/Math.sqrt(p),m=-f*p*a,h=d*p*a);var g=this.array;g[t++]=o,g[t++]=s,g[t++]=c,g[t++]=l,g[t++]=m,g[t++]=h,g[t++]=u,g[t++]=e}},{key:`setUniforms`,value:function(e,t){var n=t.gl,r=t.uniformLocations,i=r.u_matrix,a=r.u_zoomRatio,o=r.u_feather,s=r.u_pixelRatio,c=r.u_correctionRatio,l=r.u_sizeRatio,u=r.u_minEdgeThickness;n.uniformMatrix3fv(i,!1,e.matrix),n.uniform1f(a,e.zoomRatio),n.uniform1f(l,e.sizeRatio),n.uniform1f(c,e.correctionRatio),n.uniform1f(s,e.pixelRatio),n.uniform1f(o,e.antiAliasingFeather),n.uniform1f(u,e.minEdgeThickness)}}])}(H),qe=function(e){function t(){var e;return c(this,t),e=h(this,t),e.rawEmitter=e,e}return _(t,e),u(t)}(n().EventEmitter),Je=e(i()),Ye={linear:function(e){return e},quadraticIn:function(e){return e*e},quadraticOut:function(e){return e*(2-e)},quadraticInOut:function(e){return(e*=2)<1?.5*e*e:-.5*(--e*(e-2)-1)},cubicIn:function(e){return e*e*e},cubicOut:function(e){return--e*e*e+1},cubicInOut:function(e){return(e*=2)<1?.5*e*e*e:.5*((e-=2)*e*e+2)}},Xe={easing:`quadraticInOut`,duration:150};function K(){return Float32Array.of(1,0,0,0,1,0,0,0,1)}function Ze(e,t,n){return e[0]=t,e[4]=typeof n==`number`?n:t,e}function Qe(e,t){var n=Math.sin(t),r=Math.cos(t);return e[0]=r,e[1]=n,e[3]=-n,e[4]=r,e}function $e(e,t,n){return e[6]=t,e[7]=n,e}function q(e,t){var n=e[0],r=e[1],i=e[2],a=e[3],o=e[4],s=e[5],c=e[6],l=e[7],u=e[8],d=t[0],f=t[1],p=t[2],m=t[3],h=t[4],g=t[5],_=t[6],v=t[7],y=t[8];return e[0]=d*n+f*a+p*c,e[1]=d*r+f*o+p*l,e[2]=d*i+f*s+p*u,e[3]=m*n+h*a+g*c,e[4]=m*r+h*o+g*l,e[5]=m*i+h*s+g*u,e[6]=_*n+v*a+y*c,e[7]=_*r+v*o+y*l,e[8]=_*i+v*s+y*u,e}function et(e,t){var n=arguments.length>2&&arguments[2]!==void 0?arguments[2]:1,r=e[0],i=e[1],a=e[3],o=e[4],s=e[6],c=e[7],l=t.x,u=t.y;return{x:l*r+u*a+s*n,y:l*i+u*o+c*n}}function tt(e,t){var n=e.height/e.width,r=t.height/t.width;return n<1&&r>1||n>1&&r<1?1:Math.min(Math.max(r,1/r),Math.max(1/n,n))}function J(e,t,n,r,i){var a=e.angle,o=e.ratio,s=e.x,c=e.y,l=t.width,u=t.height,d=K(),f=Math.min(l,u)-2*r,p=tt(t,n);return i?(q(d,$e(K(),s,c)),q(d,Ze(K(),o)),q(d,Qe(K(),a)),q(d,Ze(K(),l/f/2/p,u/f/2/p))):(q(d,Ze(K(),f/l*2*p,f/u*2*p)),q(d,Qe(K(),-a)),q(d,Ze(K(),1/o)),q(d,$e(K(),-s,-c))),d}function nt(e,t,n){var r=et(e,{x:Math.cos(t.angle),y:Math.sin(t.angle)},0),i=r.x,a=r.y;return 1/Math.sqrt(i**2+a**2)/n.width}function rt(e){if(!e.order)return{x:[0,1],y:[0,1]};var t=1/0,n=-1/0,r=1/0,i=-1/0;return e.forEachNode(function(e,a){var o=a.x,s=a.y;o<t&&(t=o),o>n&&(n=o),s<r&&(r=s),s>i&&(i=s)}),{x:[t,n],y:[r,i]}}function it(e){if(!(0,Je.default)(e))throw Error(`Sigma: invalid graph instance.`);e.forEachNode(function(e,t){if(!Number.isFinite(t.x)||!Number.isFinite(t.y))throw Error(`Sigma: Coordinates of node ${e} are invalid. A node must have a numeric 'x' and 'y' attribute.`)})}function at(e,t,n){var r=document.createElement(e);if(t)for(var i in t)r.style[i]=t[i];if(n)for(var a in n)r.setAttribute(a,n[a]);return r}function ot(){return window.devicePixelRatio===void 0?1:window.devicePixelRatio}function st(e,t,n){return n.sort(function(e,n){var r=t(e)||0,i=t(n)||0;return r<i?-1:+(r>i)})}function ct(e){var t=C(e.x,2),n=t[0],r=t[1],i=C(e.y,2),a=i[0],o=i[1],s=Math.max(r-n,o-a),c=(r+n)/2,l=(o+a)/2;(s===0||Math.abs(s)===1/0||isNaN(s))&&(s=1),isNaN(c)&&(c=0),isNaN(l)&&(l=0);var u=function(e){return{x:.5+(e.x-c)/s,y:.5+(e.y-l)/s}};return u.applyTo=function(e){e.x=.5+(e.x-c)/s,e.y=.5+(e.y-l)/s},u.inverse=function(e){return{x:c+s*(e.x-.5),y:l+s*(e.y-.5)}},u.ratio=s,u}function lt(e){"@babel/helpers - typeof";return lt=typeof Symbol==`function`&&typeof Symbol.iterator==`symbol`?function(e){return typeof e}:function(e){return e&&typeof Symbol==`function`&&e.constructor===Symbol&&e!==Symbol.prototype?`symbol`:typeof e},lt(e)}function ut(e,t){var n=t.size;if(n!==0){var r=e.length;e.length+=n;var i=0;t.forEach(function(t){e[r+i]=t,i++})}}function dt(e){e||={};for(var t=0,n=arguments.length<=1?0:arguments.length-1;t<n;t++){var r=t+1<1||arguments.length<=t+1?void 0:arguments[t+1];r&&Object.assign(e,r)}return e}var ft={hideEdgesOnMove:!1,hideLabelsOnMove:!1,renderLabels:!0,renderEdgeLabels:!1,enableEdgeEvents:!1,defaultNodeColor:`#999`,defaultNodeType:`circle`,defaultEdgeColor:`#ccc`,defaultEdgeType:`line`,labelFont:`Arial`,labelSize:14,labelWeight:`normal`,labelColor:{color:`#000`},edgeLabelFont:`Arial`,edgeLabelSize:14,edgeLabelWeight:`normal`,edgeLabelColor:{attribute:`color`},stagePadding:30,defaultDrawEdgeLabel:he,defaultDrawNodeLabel:ge,defaultDrawNodeHover:_e,minEdgeThickness:1.7,antiAliasingFeather:1,dragTimeout:100,draggedEventsTolerance:3,inertiaDuration:200,inertiaRatio:3,zoomDuration:250,zoomingRatio:1.7,doubleClickTimeout:300,doubleClickZoomingRatio:2.2,doubleClickZoomingDuration:200,tapMoveTolerance:10,zoomToSizeRatioFunction:Math.sqrt,itemSizesReference:`screen`,autoRescale:!0,autoCenter:!0,labelDensity:1,labelGridCellSize:100,labelRenderedSizeThreshold:6,nodeReducer:null,edgeReducer:null,zIndex:!1,minCameraRatio:null,maxCameraRatio:null,enableCameraZooming:!0,enableCameraPanning:!0,enableCameraRotation:!0,cameraPanBoundaries:null,allowInvalidContainer:!1,nodeProgramClasses:{},nodeHoverProgramClasses:{},edgeProgramClasses:{}},pt={circle:we},mt={arrow:Ve,line:Ke};function ht(e){if(typeof e.labelDensity!=`number`||e.labelDensity<0)throw Error("Settings: invalid `labelDensity`. Expecting a positive number.");var t=e.minCameraRatio,n=e.maxCameraRatio;if(typeof t==`number`&&typeof n==`number`&&n<t)throw Error("Settings: invalid camera ratio boundaries. Expecting `maxCameraRatio` to be greater than `minCameraRatio`.")}function gt(e){var t=dt({},ft,e);return t.nodeProgramClasses=dt({},pt,t.nodeProgramClasses),t.edgeProgramClasses=dt({},mt,t.edgeProgramClasses),t}var _t=1.5,vt=function(e){function t(){var e;return c(this,t),e=h(this,t),L(e,`x`,.5),L(e,`y`,.5),L(e,`angle`,0),L(e,`ratio`,1),L(e,`minRatio`,null),L(e,`maxRatio`,null),L(e,`enabledZooming`,!0),L(e,`enabledPanning`,!0),L(e,`enabledRotation`,!0),L(e,`clean`,null),L(e,`nextFrame`,null),L(e,`previousState`,null),L(e,`enabled`,!0),e.previousState=e.getState(),e}return _(t,e),u(t,[{key:`enable`,value:function(){return this.enabled=!0,this}},{key:`disable`,value:function(){return this.enabled=!1,this}},{key:`getState`,value:function(){return{x:this.x,y:this.y,angle:this.angle,ratio:this.ratio}}},{key:`hasState`,value:function(e){return this.x===e.x&&this.y===e.y&&this.ratio===e.ratio&&this.angle===e.angle}},{key:`getPreviousState`,value:function(){var e=this.previousState;return e?{x:e.x,y:e.y,angle:e.angle,ratio:e.ratio}:null}},{key:`getBoundedRatio`,value:function(e){var t=e;return typeof this.minRatio==`number`&&(t=Math.max(t,this.minRatio)),typeof this.maxRatio==`number`&&(t=Math.min(t,this.maxRatio)),t}},{key:`validateState`,value:function(e){var t={};return this.enabledPanning&&typeof e.x==`number`&&(t.x=e.x),this.enabledPanning&&typeof e.y==`number`&&(t.y=e.y),this.enabledZooming&&typeof e.ratio==`number`&&(t.ratio=this.getBoundedRatio(e.ratio)),this.enabledRotation&&typeof e.angle==`number`&&(t.angle=e.angle),this.clean?this.clean(R(R({},this.getState()),t)):t}},{key:`isAnimated`,value:function(){return!!this.nextFrame}},{key:`setState`,value:function(e){if(!this.enabled)return this;this.previousState=this.getState();var t=this.validateState(e);return typeof t.x==`number`&&(this.x=t.x),typeof t.y==`number`&&(this.y=t.y),typeof t.ratio==`number`&&(this.ratio=t.ratio),typeof t.angle==`number`&&(this.angle=t.angle),this.hasState(this.previousState)||this.emit(`updated`,this.getState()),this}},{key:`updateState`,value:function(e){return this.setState(e(this.getState())),this}},{key:`animate`,value:function(e){var t=this,n=arguments.length>1&&arguments[1]!==void 0?arguments[1]:{},r=arguments.length>2?arguments[2]:void 0;if(!r)return new Promise(function(r){return t.animate(e,n,r)});if(this.enabled){var i=R(R({},Xe),n),a=this.validateState(e),o=typeof i.easing==`function`?i.easing:Ye[i.easing],s=Date.now(),c=this.getState(),l=function(){var e=(Date.now()-s)/i.duration;if(e>=1){t.nextFrame=null,t.setState(a),t.animationCallback&&=(t.animationCallback.call(null),void 0);return}var n=o(e),r={};typeof a.x==`number`&&(r.x=c.x+(a.x-c.x)*n),typeof a.y==`number`&&(r.y=c.y+(a.y-c.y)*n),t.enabledRotation&&typeof a.angle==`number`&&(r.angle=c.angle+(a.angle-c.angle)*n),typeof a.ratio==`number`&&(r.ratio=c.ratio+(a.ratio-c.ratio)*n),t.setState(r),t.nextFrame=requestAnimationFrame(l)};this.nextFrame?(cancelAnimationFrame(this.nextFrame),this.animationCallback&&this.animationCallback.call(null),this.nextFrame=requestAnimationFrame(l)):l(),this.animationCallback=r}}},{key:`animatedZoom`,value:function(e){return e?typeof e==`number`?this.animate({ratio:this.ratio/e}):this.animate({ratio:this.ratio/(e.factor||_t)},e):this.animate({ratio:this.ratio/_t})}},{key:`animatedUnzoom`,value:function(e){return e?typeof e==`number`?this.animate({ratio:this.ratio*e}):this.animate({ratio:this.ratio*(e.factor||_t)},e):this.animate({ratio:this.ratio*_t})}},{key:`animatedReset`,value:function(e){return this.animate({x:.5,y:.5,ratio:1,angle:0},e)}},{key:`copy`,value:function(){return t.from(this.getState())}}],[{key:`from`,value:function(e){return new t().setState(e)}}])}(qe);function Y(e,t){var n=t.getBoundingClientRect();return{x:e.clientX-n.left,y:e.clientY-n.top}}function X(e,t){var n=R(R({},Y(e,t)),{},{sigmaDefaultPrevented:!1,preventSigmaDefault:function(){n.sigmaDefaultPrevented=!0},original:e});return n}function yt(e){var t=`x`in e?e:R(R({},e.touches[0]||e.previousTouches[0]),{},{original:e.original,sigmaDefaultPrevented:e.sigmaDefaultPrevented,preventSigmaDefault:function(){e.sigmaDefaultPrevented=!0,t.sigmaDefaultPrevented=!0}});return t}function bt(e,t){return R(R({},X(e,t)),{},{delta:wt(e)})}var xt=2;function St(e){for(var t=[],n=0,r=Math.min(e.length,xt);n<r;n++)t.push(e[n]);return t}function Ct(e,t,n){var r={touches:St(e.touches).map(function(e){return Y(e,n)}),previousTouches:t.map(function(e){return Y(e,n)}),sigmaDefaultPrevented:!1,preventSigmaDefault:function(){r.sigmaDefaultPrevented=!0},original:e};return r}function wt(e){if(e.deltaY!==void 0)return e.deltaY*-3/360;if(e.detail!==void 0)return e.detail/-9;throw Error(`Captor: could not extract delta from event.`)}var Tt=function(e){function t(e,n){var r;return c(this,t),r=h(this,t),r.container=e,r.renderer=n,r}return _(t,e),u(t)}(qe),Et=[`doubleClickTimeout`,`doubleClickZoomingDuration`,`doubleClickZoomingRatio`,`dragTimeout`,`draggedEventsTolerance`,`inertiaDuration`,`inertiaRatio`,`zoomDuration`,`zoomingRatio`].reduce(function(e,t){return R(R({},e),{},L({},t,ft[t]))},{}),Dt=function(e){function t(e,n){var r;return c(this,t),r=h(this,t,[e,n]),L(r,`enabled`,!0),L(r,`draggedEvents`,0),L(r,`downStartTime`,null),L(r,`lastMouseX`,null),L(r,`lastMouseY`,null),L(r,`isMouseDown`,!1),L(r,`isMoving`,!1),L(r,`movingTimeout`,null),L(r,`startCameraState`,null),L(r,`clicks`,0),L(r,`doubleClickTimeout`,null),L(r,`currentWheelDirection`,0),L(r,`settings`,Et),r.handleClick=r.handleClick.bind(r),r.handleRightClick=r.handleRightClick.bind(r),r.handleDown=r.handleDown.bind(r),r.handleUp=r.handleUp.bind(r),r.handleMove=r.handleMove.bind(r),r.handleWheel=r.handleWheel.bind(r),r.handleLeave=r.handleLeave.bind(r),r.handleEnter=r.handleEnter.bind(r),e.addEventListener(`click`,r.handleClick,{capture:!1}),e.addEventListener(`contextmenu`,r.handleRightClick,{capture:!1}),e.addEventListener(`mousedown`,r.handleDown,{capture:!1}),e.addEventListener(`wheel`,r.handleWheel,{capture:!1}),e.addEventListener(`mouseleave`,r.handleLeave,{capture:!1}),e.addEventListener(`mouseenter`,r.handleEnter,{capture:!1}),document.addEventListener(`mousemove`,r.handleMove,{capture:!1}),document.addEventListener(`mouseup`,r.handleUp,{capture:!1}),r}return _(t,e),u(t,[{key:`kill`,value:function(){var e=this.container;e.removeEventListener(`click`,this.handleClick),e.removeEventListener(`contextmenu`,this.handleRightClick),e.removeEventListener(`mousedown`,this.handleDown),e.removeEventListener(`wheel`,this.handleWheel),e.removeEventListener(`mouseleave`,this.handleLeave),e.removeEventListener(`mouseenter`,this.handleEnter),document.removeEventListener(`mousemove`,this.handleMove),document.removeEventListener(`mouseup`,this.handleUp)}},{key:`handleClick`,value:function(e){var t=this;if(this.enabled){if(this.clicks++,this.clicks===2)return this.clicks=0,typeof this.doubleClickTimeout==`number`&&(clearTimeout(this.doubleClickTimeout),this.doubleClickTimeout=null),this.handleDoubleClick(e);setTimeout(function(){t.clicks=0,t.doubleClickTimeout=null},this.settings.doubleClickTimeout),this.draggedEvents<this.settings.draggedEventsTolerance&&this.emit(`click`,X(e,this.container))}}},{key:`handleRightClick`,value:function(e){this.enabled&&this.emit(`rightClick`,X(e,this.container))}},{key:`handleDoubleClick`,value:function(e){if(this.enabled){e.preventDefault(),e.stopPropagation();var t=X(e,this.container);if(this.emit(`doubleClick`,t),!t.sigmaDefaultPrevented){var n=this.renderer.getCamera(),r=n.getBoundedRatio(n.getState().ratio/this.settings.doubleClickZoomingRatio);n.animate(this.renderer.getViewportZoomedState(Y(e,this.container),r),{easing:`quadraticInOut`,duration:this.settings.doubleClickZoomingDuration})}}}},{key:`handleDown`,value:function(e){if(this.enabled){if(e.button===0){this.startCameraState=this.renderer.getCamera().getState();var t=Y(e,this.container),n=t.x,r=t.y;this.lastMouseX=n,this.lastMouseY=r,this.draggedEvents=0,this.downStartTime=Date.now(),this.isMouseDown=!0}this.emit(`mousedown`,X(e,this.container))}}},{key:`handleUp`,value:function(e){var t=this;if(!(!this.enabled||!this.isMouseDown)){var n=this.renderer.getCamera();this.isMouseDown=!1,typeof this.movingTimeout==`number`&&(clearTimeout(this.movingTimeout),this.movingTimeout=null);var r=Y(e,this.container),i=r.x,a=r.y,o=n.getState(),s=n.getPreviousState()||{x:0,y:0};this.isMoving?n.animate({x:o.x+this.settings.inertiaRatio*(o.x-s.x),y:o.y+this.settings.inertiaRatio*(o.y-s.y)},{duration:this.settings.inertiaDuration,easing:`quadraticOut`}):(this.lastMouseX!==i||this.lastMouseY!==a)&&n.setState({x:o.x,y:o.y}),this.isMoving=!1,setTimeout(function(){var e=t.draggedEvents>0;t.draggedEvents=0,e&&t.renderer.getSetting(`hideEdgesOnMove`)&&t.renderer.refresh()},0),this.emit(`mouseup`,X(e,this.container))}}},{key:`handleMove`,value:function(e){var t=this;if(this.enabled){var n=X(e,this.container);if(this.emit(`mousemovebody`,n),(e.target===this.container||e.composedPath()[0]===this.container)&&this.emit(`mousemove`,n),!n.sigmaDefaultPrevented&&this.isMouseDown){this.isMoving=!0,this.draggedEvents++,typeof this.movingTimeout==`number`&&clearTimeout(this.movingTimeout),this.movingTimeout=window.setTimeout(function(){t.movingTimeout=null,t.isMoving=!1},this.settings.dragTimeout);var r=this.renderer.getCamera(),i=Y(e,this.container),a=i.x,o=i.y,s=this.renderer.viewportToFramedGraph({x:this.lastMouseX,y:this.lastMouseY}),c=this.renderer.viewportToFramedGraph({x:a,y:o}),l=s.x-c.x,u=s.y-c.y,d=r.getState(),f=d.x+l,p=d.y+u;r.setState({x:f,y:p}),this.lastMouseX=a,this.lastMouseY=o,e.preventDefault(),e.stopPropagation()}}}},{key:`handleLeave`,value:function(e){this.emit(`mouseleave`,X(e,this.container))}},{key:`handleEnter`,value:function(e){this.emit(`mouseenter`,X(e,this.container))}},{key:`handleWheel`,value:function(e){var t=this,n=this.renderer.getCamera();if(!(!this.enabled||!n.enabledZooming)){var r=wt(e);if(r){var i=bt(e,this.container);if(this.emit(`wheel`,i),i.sigmaDefaultPrevented){e.preventDefault(),e.stopPropagation();return}var a=n.getState().ratio,o=r>0?1/this.settings.zoomingRatio:this.settings.zoomingRatio,s=n.getBoundedRatio(a*o),c=r>0?1:-1,l=Date.now();a!==s&&(e.preventDefault(),e.stopPropagation(),!(this.currentWheelDirection===c&&this.lastWheelTriggerTime&&l-this.lastWheelTriggerTime<this.settings.zoomDuration/5)&&(n.animate(this.renderer.getViewportZoomedState(Y(e,this.container),s),{easing:`quadraticOut`,duration:this.settings.zoomDuration},function(){t.currentWheelDirection=0}),this.currentWheelDirection=c,this.lastWheelTriggerTime=l))}}}},{key:`setSettings`,value:function(e){this.settings=e}}])}(Tt),Ot=[`dragTimeout`,`inertiaDuration`,`inertiaRatio`,`doubleClickTimeout`,`doubleClickZoomingRatio`,`doubleClickZoomingDuration`,`tapMoveTolerance`].reduce(function(e,t){return R(R({},e),{},L({},t,ft[t]))},{}),kt=function(e){function t(e,n){var r;return c(this,t),r=h(this,t,[e,n]),L(r,`enabled`,!0),L(r,`isMoving`,!1),L(r,`hasMoved`,!1),L(r,`touchMode`,0),L(r,`startTouchesPositions`,[]),L(r,`lastTouches`,[]),L(r,`lastTap`,null),L(r,`settings`,Ot),r.handleStart=r.handleStart.bind(r),r.handleLeave=r.handleLeave.bind(r),r.handleMove=r.handleMove.bind(r),e.addEventListener(`touchstart`,r.handleStart,{capture:!1}),e.addEventListener(`touchcancel`,r.handleLeave,{capture:!1}),document.addEventListener(`touchend`,r.handleLeave,{capture:!1,passive:!1}),document.addEventListener(`touchmove`,r.handleMove,{capture:!1,passive:!1}),r}return _(t,e),u(t,[{key:`kill`,value:function(){var e=this.container;e.removeEventListener(`touchstart`,this.handleStart),e.removeEventListener(`touchcancel`,this.handleLeave),document.removeEventListener(`touchend`,this.handleLeave),document.removeEventListener(`touchmove`,this.handleMove)}},{key:`getDimensions`,value:function(){return{width:this.container.offsetWidth,height:this.container.offsetHeight}}},{key:`handleStart`,value:function(e){var t=this;if(this.enabled){e.preventDefault();var n=St(e.touches);if(this.touchMode=n.length,this.startCameraState=this.renderer.getCamera().getState(),this.startTouchesPositions=n.map(function(e){return Y(e,t.container)}),this.touchMode===2){var r=C(this.startTouchesPositions,2),i=r[0],a=i.x,o=i.y,s=r[1],c=s.x,l=s.y;this.startTouchesAngle=Math.atan2(l-o,c-a),this.startTouchesDistance=Math.sqrt((c-a)**2+(l-o)**2)}this.emit(`touchdown`,Ct(e,this.lastTouches,this.container)),this.lastTouches=n,this.lastTouchesPositions=this.startTouchesPositions}}},{key:`handleLeave`,value:function(e){if(!(!this.enabled||!this.startTouchesPositions.length)){switch(e.cancelable&&e.preventDefault(),this.movingTimeout&&(this.isMoving=!1,clearTimeout(this.movingTimeout)),this.touchMode){case 2:if(e.touches.length===1){this.handleStart(e),e.preventDefault();break}case 1:if(this.isMoving){var t=this.renderer.getCamera(),n=t.getState(),r=t.getPreviousState()||{x:0,y:0};t.animate({x:n.x+this.settings.inertiaRatio*(n.x-r.x),y:n.y+this.settings.inertiaRatio*(n.y-r.y)},{duration:this.settings.inertiaDuration,easing:`quadraticOut`})}this.hasMoved=!1,this.isMoving=!1,this.touchMode=0}if(this.emit(`touchup`,Ct(e,this.lastTouches,this.container)),!e.touches.length){var i=Y(this.lastTouches[0],this.container),a=this.startTouchesPositions[0],o=(i.x-a.x)**2+(i.y-a.y)**2;if(!e.touches.length&&o<this.settings.tapMoveTolerance**2){if(this.lastTap&&Date.now()-this.lastTap.time<this.settings.doubleClickTimeout){var s=Ct(e,this.lastTouches,this.container);if(this.emit(`doubletap`,s),this.lastTap=null,!s.sigmaDefaultPrevented){var c=this.renderer.getCamera(),l=c.getBoundedRatio(c.getState().ratio/this.settings.doubleClickZoomingRatio);c.animate(this.renderer.getViewportZoomedState(i,l),{easing:`quadraticInOut`,duration:this.settings.doubleClickZoomingDuration})}}else{var u=Ct(e,this.lastTouches,this.container);this.emit(`tap`,u),this.lastTap={time:Date.now(),position:u.touches[0]||u.previousTouches[0]}}}}this.lastTouches=St(e.touches),this.startTouchesPositions=[]}}},{key:`handleMove`,value:function(e){var t=this;if(!(!this.enabled||!this.startTouchesPositions.length)){e.preventDefault();var n=St(e.touches),r=n.map(function(e){return Y(e,t.container)}),i=this.lastTouches;this.lastTouches=n,this.lastTouchesPositions=r;var a=Ct(e,i,this.container);if(this.emit(`touchmove`,a),!a.sigmaDefaultPrevented&&(this.hasMoved||=r.some(function(e,n){var r=t.startTouchesPositions[n];return r&&(e.x!==r.x||e.y!==r.y)}),this.hasMoved)){this.isMoving=!0,this.movingTimeout&&clearTimeout(this.movingTimeout),this.movingTimeout=window.setTimeout(function(){t.isMoving=!1},this.settings.dragTimeout);var o=this.renderer.getCamera(),s=this.startCameraState,c=this.renderer.getSetting(`stagePadding`);switch(this.touchMode){case 1:var l=this.renderer.viewportToFramedGraph((this.startTouchesPositions||[])[0]),u=l.x,d=l.y,f=this.renderer.viewportToFramedGraph(r[0]),p=f.x,m=f.y;o.setState({x:s.x+u-p,y:s.y+d-m});break;case 2:var h={x:.5,y:.5,angle:0,ratio:1},g=r[0],_=g.x,v=g.y,y=r[1],b=y.x,x=y.y,S=Math.atan2(x-v,b-_)-this.startTouchesAngle,C=Math.hypot(x-v,b-_)/this.startTouchesDistance,w=o.getBoundedRatio(s.ratio/C);h.ratio=w,h.angle=s.angle+S;var T=this.getDimensions(),E=this.renderer.viewportToFramedGraph((this.startTouchesPositions||[])[0],{cameraState:s}),D=Math.min(T.width,T.height)-2*c,O=D/T.width,k=D/T.height,A=w/D,j=_-D/2/O,M=v-D/2/k,N=[j*Math.cos(-h.angle)-M*Math.sin(-h.angle),M*Math.cos(-h.angle)+j*Math.sin(-h.angle)];j=N[0],M=N[1],h.x=E.x-j*A,h.y=E.y+M*A,o.setState(h)}}}}},{key:`setSettings`,value:function(e){this.settings=e}}])}(Tt);function At(e){if(Array.isArray(e))return b(e)}function jt(e){if(typeof Symbol<`u`&&e[Symbol.iterator]!=null||e[`@@iterator`]!=null)return Array.from(e)}function Mt(){throw TypeError(`Invalid attempt to spread non-iterable instance.
In order to be iterable, non-array objects must have a [Symbol.iterator]() method.`)}function Nt(e){return At(e)||jt(e)||x(e)||Mt()}function Pt(e,t){if(e==null)return{};var n={};for(var r in e)if({}.hasOwnProperty.call(e,r)){if(t.indexOf(r)!==-1)continue;n[r]=e[r]}return n}function Ft(e,t){if(e==null)return{};var n,r,i=Pt(e,t);if(Object.getOwnPropertySymbols){var a=Object.getOwnPropertySymbols(e);for(r=0;r<a.length;r++)n=a[r],t.indexOf(n)===-1&&{}.propertyIsEnumerable.call(e,n)&&(i[n]=e[n])}return i}var It=function(){function e(t,n){c(this,e),this.key=t,this.size=n}return u(e,null,[{key:`compare`,value:function(e,t){return e.size>t.size?-1:e.size<t.size||e.key>t.key?1:-1}}])}(),Lt=function(){function e(){c(this,e),L(this,`width`,0),L(this,`height`,0),L(this,`cellSize`,0),L(this,`columns`,0),L(this,`rows`,0),L(this,`cells`,{})}return u(e,[{key:`resizeAndClear`,value:function(e,t){this.width=e.width,this.height=e.height,this.cellSize=t,this.columns=Math.ceil(e.width/t),this.rows=Math.ceil(e.height/t),this.cells={}}},{key:`getIndex`,value:function(e){var t=Math.floor(e.x/this.cellSize);return Math.floor(e.y/this.cellSize)*this.columns+t}},{key:`add`,value:function(e,t,n){var r=new It(e,t),i=this.getIndex(n),a=this.cells[i];a||(a=[],this.cells[i]=a),a.push(r)}},{key:`organize`,value:function(){for(var e in this.cells)this.cells[e].sort(It.compare)}},{key:`getLabelsToDisplay`,value:function(e,t){var n=this.cellSize*this.cellSize,r=n/e/e*t/n,i=Math.ceil(r),a=[];for(var o in this.cells)for(var s=this.cells[o],c=0;c<Math.min(i,s.length);c++)a.push(s[c].key);return a}}])}();function Rt(e){var t=e.graph,n=e.hoveredNode,r=e.highlightedNodes,i=e.displayedNodeLabels,a=[];return t.forEachEdge(function(e,t,o,s){(o===n||s===n||r.has(o)||r.has(s)||i.has(o)&&i.has(s))&&a.push(e)}),a}var zt=150,Bt=50,Z=Object.prototype.hasOwnProperty;function Vt(e,t,n){if(!Z.call(n,`x`)||!Z.call(n,`y`))throw Error(`Sigma: could not find a valid position (x, y) for node "${t}". All your nodes must have a number "x" and "y". Maybe your forgot to apply a layout or your "nodeReducer" is not returning the correct data?`);return n.color||=e.defaultNodeColor,!n.label&&n.label!==``&&(n.label=null),n.label=n.label!==void 0&&n.label!==null?``+n.label:null,n.size||=2,Z.call(n,`hidden`)||(n.hidden=!1),Z.call(n,`highlighted`)||(n.highlighted=!1),Z.call(n,`forceLabel`)||(n.forceLabel=!1),(!n.type||n.type===``)&&(n.type=e.defaultNodeType),n.zIndex||=0,n}function Ht(e,t,n){return n.color||=e.defaultEdgeColor,n.label||=``,n.size||=.5,Z.call(n,`hidden`)||(n.hidden=!1),Z.call(n,`forceLabel`)||(n.forceLabel=!1),(!n.type||n.type===``)&&(n.type=e.defaultEdgeType),n.zIndex||=0,n}var Ut=function(e){function t(e,n){var r,i=arguments.length>2&&arguments[2]!==void 0?arguments[2]:{};if(c(this,t),r=h(this,t),L(r,`elements`,{}),L(r,`canvasContexts`,{}),L(r,`webGLContexts`,{}),L(r,`pickingLayers`,new Set),L(r,`textures`,{}),L(r,`frameBuffers`,{}),L(r,`activeListeners`,{}),L(r,`labelGrid`,new Lt),L(r,`nodeDataCache`,{}),L(r,`edgeDataCache`,{}),L(r,`nodeProgramIndex`,{}),L(r,`edgeProgramIndex`,{}),L(r,`nodesWithForcedLabels`,new Set),L(r,`edgesWithForcedLabels`,new Set),L(r,`nodeExtent`,{x:[0,1],y:[0,1]}),L(r,`nodeZExtent`,[1/0,-1/0]),L(r,`edgeZExtent`,[1/0,-1/0]),L(r,`matrix`,K()),L(r,`invMatrix`,K()),L(r,`correctionRatio`,1),L(r,`customBBox`,null),L(r,`normalizationFunction`,ct({x:[0,1],y:[0,1]})),L(r,`graphToViewportRatio`,1),L(r,`itemIDsIndex`,{}),L(r,`nodeIndices`,{}),L(r,`edgeIndices`,{}),L(r,`width`,0),L(r,`height`,0),L(r,`pixelRatio`,ot()),L(r,`pickingDownSizingRatio`,2*r.pixelRatio),L(r,`displayedNodeLabels`,new Set),L(r,`displayedEdgeLabels`,new Set),L(r,`highlightedNodes`,new Set),L(r,`hoveredNode`,null),L(r,`hoveredEdge`,null),L(r,`renderFrame`,null),L(r,`renderHighlightedNodesFrame`,null),L(r,`needToProcess`,!1),L(r,`checkEdgesEventsFrame`,null),L(r,`nodePrograms`,{}),L(r,`nodeHoverPrograms`,{}),L(r,`edgePrograms`,{}),r.settings=gt(i),ht(r.settings),it(e),!(n instanceof HTMLElement))throw Error(`Sigma: container should be an html element.`);for(var a in r.graph=e,r.container=n,r.createWebGLContext(`edges`,{picking:i.enableEdgeEvents}),r.createCanvasContext(`edgeLabels`),r.createWebGLContext(`nodes`,{picking:!0}),r.createCanvasContext(`labels`),r.createCanvasContext(`hovers`),r.createWebGLContext(`hoverNodes`),r.createCanvasContext(`mouse`,{style:{touchAction:`none`,userSelect:`none`}}),r.resize(),r.settings.nodeProgramClasses)r.registerNodeProgram(a,r.settings.nodeProgramClasses[a],r.settings.nodeHoverProgramClasses[a]);for(var o in r.settings.edgeProgramClasses)r.registerEdgeProgram(o,r.settings.edgeProgramClasses[o]);return r.camera=new vt,r.bindCameraHandlers(),r.mouseCaptor=new Dt(r.elements.mouse,r),r.mouseCaptor.setSettings(r.settings),r.touchCaptor=new kt(r.elements.mouse,r),r.touchCaptor.setSettings(r.settings),r.bindEventHandlers(),r.bindGraphHandlers(),r.handleSettingsUpdate(),r.refresh(),r}return _(t,e),u(t,[{key:`registerNodeProgram`,value:function(e,t,n){return this.nodePrograms[e]&&this.nodePrograms[e].kill(),this.nodeHoverPrograms[e]&&this.nodeHoverPrograms[e].kill(),this.nodePrograms[e]=new t(this.webGLContexts.nodes,this.frameBuffers.nodes,this),this.nodeHoverPrograms[e]=new(n||t)(this.webGLContexts.hoverNodes,null,this),this}},{key:`registerEdgeProgram`,value:function(e,t){return this.edgePrograms[e]&&this.edgePrograms[e].kill(),this.edgePrograms[e]=new t(this.webGLContexts.edges,this.frameBuffers.edges,this),this}},{key:`unregisterNodeProgram`,value:function(e){if(this.nodePrograms[e]){var t=this.nodePrograms,n=t[e],r=Ft(t,[e].map(s));n.kill(),this.nodePrograms=r}if(this.nodeHoverPrograms[e]){var i=this.nodeHoverPrograms,a=i[e],o=Ft(i,[e].map(s));a.kill(),this.nodePrograms=o}return this}},{key:`unregisterEdgeProgram`,value:function(e){if(this.edgePrograms[e]){var t=this.edgePrograms,n=t[e],r=Ft(t,[e].map(s));n.kill(),this.edgePrograms=r}return this}},{key:`resetWebGLTexture`,value:function(e){var t=this.webGLContexts[e],n=this.frameBuffers[e],r=this.textures[e];r&&t.deleteTexture(r);var i=t.createTexture();return t.bindFramebuffer(t.FRAMEBUFFER,n),t.bindTexture(t.TEXTURE_2D,i),t.texImage2D(t.TEXTURE_2D,0,t.RGBA,this.width,this.height,0,t.RGBA,t.UNSIGNED_BYTE,null),t.framebufferTexture2D(t.FRAMEBUFFER,t.COLOR_ATTACHMENT0,t.TEXTURE_2D,i,0),this.textures[e]=i,this}},{key:`bindCameraHandlers`,value:function(){var e=this;return this.activeListeners.camera=function(){e.scheduleRender()},this.camera.on(`updated`,this.activeListeners.camera),this}},{key:`unbindCameraHandlers`,value:function(){return this.camera.removeListener(`updated`,this.activeListeners.camera),this}},{key:`getNodeAtPosition`,value:function(e){var t=e.x,n=e.y,r=te(this.webGLContexts.nodes,this.frameBuffers.nodes,t,n,this.pixelRatio,this.pickingDownSizingRatio),i=ee.apply(void 0,Nt(r)),a=this.itemIDsIndex[i];return a&&a.type===`node`?a.id:null}},{key:`bindEventHandlers`,value:function(){var e=this;this.activeListeners.handleResize=function(){e.scheduleRefresh()},window.addEventListener(`resize`,this.activeListeners.handleResize),this.activeListeners.handleMove=function(t){var n=yt(t),r={event:n,preventSigmaDefault:function(){n.preventSigmaDefault()}},i=e.getNodeAtPosition(n);if(i&&e.hoveredNode!==i&&!e.nodeDataCache[i].hidden){e.hoveredNode&&e.emit(`leaveNode`,R(R({},r),{},{node:e.hoveredNode})),e.hoveredNode=i,e.emit(`enterNode`,R(R({},r),{},{node:i})),e.scheduleHighlightedNodesRender();return}if(e.hoveredNode&&e.getNodeAtPosition(n)!==e.hoveredNode){var a=e.hoveredNode;e.hoveredNode=null,e.emit(`leaveNode`,R(R({},r),{},{node:a})),e.scheduleHighlightedNodesRender();return}if(e.settings.enableEdgeEvents){var o=e.hoveredNode?null:e.getEdgeAtPoint(r.event.x,r.event.y);o!==e.hoveredEdge&&(e.hoveredEdge&&e.emit(`leaveEdge`,R(R({},r),{},{edge:e.hoveredEdge})),o&&e.emit(`enterEdge`,R(R({},r),{},{edge:o})),e.hoveredEdge=o)}},this.activeListeners.handleMoveBody=function(t){var n=yt(t);e.emit(`moveBody`,{event:n,preventSigmaDefault:function(){n.preventSigmaDefault()}})},this.activeListeners.handleLeave=function(t){var n=yt(t),r={event:n,preventSigmaDefault:function(){n.preventSigmaDefault()}};e.hoveredNode&&(e.emit(`leaveNode`,R(R({},r),{},{node:e.hoveredNode})),e.scheduleHighlightedNodesRender()),e.settings.enableEdgeEvents&&e.hoveredEdge&&(e.emit(`leaveEdge`,R(R({},r),{},{edge:e.hoveredEdge})),e.scheduleHighlightedNodesRender()),e.emit(`leaveStage`,R({},r))},this.activeListeners.handleEnter=function(t){var n=yt(t),r={event:n,preventSigmaDefault:function(){n.preventSigmaDefault()}};e.emit(`enterStage`,R({},r))};var t=function(t){return function(n){var r=yt(n),i={event:r,preventSigmaDefault:function(){r.preventSigmaDefault()}},a=e.getNodeAtPosition(r);if(a)return e.emit(`${t}Node`,R(R({},i),{},{node:a}));if(e.settings.enableEdgeEvents){var o=e.getEdgeAtPoint(r.x,r.y);if(o)return e.emit(`${t}Edge`,R(R({},i),{},{edge:o}))}return e.emit(`${t}Stage`,i)}};return this.activeListeners.handleClick=t(`click`),this.activeListeners.handleRightClick=t(`rightClick`),this.activeListeners.handleDoubleClick=t(`doubleClick`),this.activeListeners.handleWheel=t(`wheel`),this.activeListeners.handleDown=t(`down`),this.activeListeners.handleUp=t(`up`),this.mouseCaptor.on(`mousemove`,this.activeListeners.handleMove),this.mouseCaptor.on(`mousemovebody`,this.activeListeners.handleMoveBody),this.mouseCaptor.on(`click`,this.activeListeners.handleClick),this.mouseCaptor.on(`rightClick`,this.activeListeners.handleRightClick),this.mouseCaptor.on(`doubleClick`,this.activeListeners.handleDoubleClick),this.mouseCaptor.on(`wheel`,this.activeListeners.handleWheel),this.mouseCaptor.on(`mousedown`,this.activeListeners.handleDown),this.mouseCaptor.on(`mouseup`,this.activeListeners.handleUp),this.mouseCaptor.on(`mouseleave`,this.activeListeners.handleLeave),this.mouseCaptor.on(`mouseenter`,this.activeListeners.handleEnter),this.touchCaptor.on(`touchdown`,this.activeListeners.handleDown),this.touchCaptor.on(`touchdown`,this.activeListeners.handleMove),this.touchCaptor.on(`touchup`,this.activeListeners.handleUp),this.touchCaptor.on(`touchmove`,this.activeListeners.handleMove),this.touchCaptor.on(`tap`,this.activeListeners.handleClick),this.touchCaptor.on(`doubletap`,this.activeListeners.handleDoubleClick),this.touchCaptor.on(`touchmove`,this.activeListeners.handleMoveBody),this}},{key:`bindGraphHandlers`,value:function(){var e=this,t=this.graph,n=new Set([`x`,`y`,`zIndex`,`type`]);return this.activeListeners.eachNodeAttributesUpdatedGraphUpdate=function(r){var i=r.hints?.attributes;e.graph.forEachNode(function(t){return e.updateNode(t)});var a=!i||i.some(function(e){return n.has(e)});e.refresh({partialGraph:{nodes:t.nodes()},skipIndexation:!a,schedule:!0})},this.activeListeners.eachEdgeAttributesUpdatedGraphUpdate=function(n){var r=n.hints?.attributes;e.graph.forEachEdge(function(t){return e.updateEdge(t)});var i=r&&[`zIndex`,`type`].some(function(e){return r?.includes(e)});e.refresh({partialGraph:{edges:t.edges()},skipIndexation:!i,schedule:!0})},this.activeListeners.addNodeGraphUpdate=function(t){var n=t.key;e.addNode(n),e.refresh({partialGraph:{nodes:[n]},skipIndexation:!1,schedule:!0})},this.activeListeners.updateNodeGraphUpdate=function(t){var n=t.key;e.refresh({partialGraph:{nodes:[n]},skipIndexation:!1,schedule:!0})},this.activeListeners.dropNodeGraphUpdate=function(t){var n=t.key;e.removeNode(n),e.refresh({schedule:!0})},this.activeListeners.addEdgeGraphUpdate=function(t){var n=t.key;e.addEdge(n),e.refresh({partialGraph:{edges:[n]},schedule:!0})},this.activeListeners.updateEdgeGraphUpdate=function(t){var n=t.key;e.refresh({partialGraph:{edges:[n]},skipIndexation:!1,schedule:!0})},this.activeListeners.dropEdgeGraphUpdate=function(t){var n=t.key;e.removeEdge(n),e.refresh({schedule:!0})},this.activeListeners.clearEdgesGraphUpdate=function(){e.clearEdgeState(),e.clearEdgeIndices(),e.refresh({schedule:!0})},this.activeListeners.clearGraphUpdate=function(){e.clearEdgeState(),e.clearNodeState(),e.clearEdgeIndices(),e.clearNodeIndices(),e.refresh({schedule:!0})},t.on(`nodeAdded`,this.activeListeners.addNodeGraphUpdate),t.on(`nodeDropped`,this.activeListeners.dropNodeGraphUpdate),t.on(`nodeAttributesUpdated`,this.activeListeners.updateNodeGraphUpdate),t.on(`eachNodeAttributesUpdated`,this.activeListeners.eachNodeAttributesUpdatedGraphUpdate),t.on(`edgeAdded`,this.activeListeners.addEdgeGraphUpdate),t.on(`edgeDropped`,this.activeListeners.dropEdgeGraphUpdate),t.on(`edgeAttributesUpdated`,this.activeListeners.updateEdgeGraphUpdate),t.on(`eachEdgeAttributesUpdated`,this.activeListeners.eachEdgeAttributesUpdatedGraphUpdate),t.on(`edgesCleared`,this.activeListeners.clearEdgesGraphUpdate),t.on(`cleared`,this.activeListeners.clearGraphUpdate),this}},{key:`unbindGraphHandlers`,value:function(){var e=this.graph;e.removeListener(`nodeAdded`,this.activeListeners.addNodeGraphUpdate),e.removeListener(`nodeDropped`,this.activeListeners.dropNodeGraphUpdate),e.removeListener(`nodeAttributesUpdated`,this.activeListeners.updateNodeGraphUpdate),e.removeListener(`eachNodeAttributesUpdated`,this.activeListeners.eachNodeAttributesUpdatedGraphUpdate),e.removeListener(`edgeAdded`,this.activeListeners.addEdgeGraphUpdate),e.removeListener(`edgeDropped`,this.activeListeners.dropEdgeGraphUpdate),e.removeListener(`edgeAttributesUpdated`,this.activeListeners.updateEdgeGraphUpdate),e.removeListener(`eachEdgeAttributesUpdated`,this.activeListeners.eachEdgeAttributesUpdatedGraphUpdate),e.removeListener(`edgesCleared`,this.activeListeners.clearEdgesGraphUpdate),e.removeListener(`cleared`,this.activeListeners.clearGraphUpdate)}},{key:`getEdgeAtPoint`,value:function(e,t){var n=te(this.webGLContexts.edges,this.frameBuffers.edges,e,t,this.pixelRatio,this.pickingDownSizingRatio),r=ee.apply(void 0,Nt(n)),i=this.itemIDsIndex[r];return i&&i.type===`edge`?i.id:null}},{key:`process`,value:function(){var e=this;this.emit(`beforeProcess`);var t=this.graph,n=this.settings,r=this.getDimensions();if(this.nodeExtent=rt(this.graph),!this.settings.autoRescale){var i=r.width,a=r.height,o=this.nodeExtent,s=o.x,c=o.y;this.nodeExtent={x:[(s[0]+s[1])/2-i/2,(s[0]+s[1])/2+i/2],y:[(c[0]+c[1])/2-a/2,(c[0]+c[1])/2+a/2]}}this.normalizationFunction=ct(this.customBBox||this.nodeExtent);var l=J(new vt().getState(),r,this.getGraphDimensions(),this.getStagePadding());this.labelGrid.resizeAndClear(r,n.labelGridCellSize);for(var u={},d={},f={},p={},m=1,h=t.nodes(),g=0,_=h.length;g<_;g++){var v=h[g],y=this.nodeDataCache[v],b=t.getNodeAttributes(v);y.x=b.x,y.y=b.y,this.normalizationFunction.applyTo(y),typeof y.label==`string`&&!y.hidden&&this.labelGrid.add(v,y.size,this.framedGraphToViewport(y,{matrix:l})),u[y.type]=(u[y.type]||0)+1}for(var x in this.labelGrid.organize(),this.nodePrograms){if(!Z.call(this.nodePrograms,x))throw Error(`Sigma: could not find a suitable program for node type "${x}"!`);this.nodePrograms[x].reallocate(u[x]||0),u[x]=0}this.settings.zIndex&&this.nodeZExtent[0]!==this.nodeZExtent[1]&&(h=st(this.nodeZExtent,function(t){return e.nodeDataCache[t].zIndex},h));for(var S=0,C=h.length;S<C;S++){var w=h[S];d[w]=m,p[d[w]]={type:`node`,id:w},m++;var T=this.nodeDataCache[w];this.addNodeToProgram(w,d[w],u[T.type]++)}for(var E={},D=t.edges(),O=0,k=D.length;O<k;O++){var A=D[O],j=this.edgeDataCache[A];E[j.type]=(E[j.type]||0)+1}for(var M in this.settings.zIndex&&this.edgeZExtent[0]!==this.edgeZExtent[1]&&(D=st(this.edgeZExtent,function(t){return e.edgeDataCache[t].zIndex},D)),this.edgePrograms){if(!Z.call(this.edgePrograms,M))throw Error(`Sigma: could not find a suitable program for edge type "${M}"!`);this.edgePrograms[M].reallocate(E[M]||0),E[M]=0}for(var N=0,P=D.length;N<P;N++){var F=D[N];f[F]=m,p[f[F]]={type:`edge`,id:F},m++;var I=this.edgeDataCache[F];this.addEdgeToProgram(F,f[F],E[I.type]++)}return this.itemIDsIndex=p,this.nodeIndices=d,this.edgeIndices=f,this.emit(`afterProcess`),this}},{key:`handleSettingsUpdate`,value:function(e){var t=this,n=this.settings;if(this.camera.minRatio=n.minCameraRatio,this.camera.maxRatio=n.maxCameraRatio,this.camera.enabledZooming=n.enableCameraZooming,this.camera.enabledPanning=n.enableCameraPanning,this.camera.enabledRotation=n.enableCameraRotation,n.cameraPanBoundaries?this.camera.clean=function(e){return t.cleanCameraState(e,n.cameraPanBoundaries&&lt(n.cameraPanBoundaries)===`object`?n.cameraPanBoundaries:{})}:this.camera.clean=null,this.camera.setState(this.camera.validateState(this.camera.getState())),e){if(e.edgeProgramClasses!==n.edgeProgramClasses){for(var r in n.edgeProgramClasses)n.edgeProgramClasses[r]!==e.edgeProgramClasses[r]&&this.registerEdgeProgram(r,n.edgeProgramClasses[r]);for(var i in e.edgeProgramClasses)n.edgeProgramClasses[i]||this.unregisterEdgeProgram(i)}if(e.nodeProgramClasses!==n.nodeProgramClasses||e.nodeHoverProgramClasses!==n.nodeHoverProgramClasses){for(var a in n.nodeProgramClasses)(n.nodeProgramClasses[a]!==e.nodeProgramClasses[a]||n.nodeHoverProgramClasses[a]!==e.nodeHoverProgramClasses[a])&&this.registerNodeProgram(a,n.nodeProgramClasses[a],n.nodeHoverProgramClasses[a]);for(var o in e.nodeProgramClasses)n.nodeProgramClasses[o]||this.unregisterNodeProgram(o)}}return this.mouseCaptor.setSettings(this.settings),this.touchCaptor.setSettings(this.settings),this}},{key:`cleanCameraState`,value:function(e){var t=arguments.length>1&&arguments[1]!==void 0?arguments[1]:{},n=t.tolerance,r=n===void 0?0:n,i=t.boundaries,a=R({},e),o=i||this.nodeExtent,s=C(o.x,2),c=s[0],l=s[1],u=C(o.y,2),d=u[0],f=u[1],p=[this.graphToViewport({x:c,y:d},{cameraState:e}),this.graphToViewport({x:l,y:d},{cameraState:e}),this.graphToViewport({x:c,y:f},{cameraState:e}),this.graphToViewport({x:l,y:f},{cameraState:e})],m=1/0,h=-1/0,g=1/0,_=-1/0;p.forEach(function(e){var t=e.x,n=e.y;m=Math.min(m,t),h=Math.max(h,t),g=Math.min(g,n),_=Math.max(_,n)});var v=h-m,y=_-g,b=this.getDimensions(),x=b.width,S=b.height,w=0,T=0;if(v>=x?h<x-r?w=h-(x-r):m>r&&(w=m-r):h>x+r?w=h-(x+r):m<-r&&(w=m+r),y>=S?_<S-r?T=_-(S-r):g>r&&(T=g-r):_>S+r?T=_-(S+r):g<-r&&(T=g+r),w||T){var E=this.viewportToFramedGraph({x:0,y:0},{cameraState:e}),D=this.viewportToFramedGraph({x:w,y:T},{cameraState:e});w=D.x-E.x,T=D.y-E.y,a.x+=w,a.y+=T}return a}},{key:`renderLabels`,value:function(){if(!this.settings.renderLabels)return this;var e=this.camera.getState(),t=this.labelGrid.getLabelsToDisplay(e.ratio,this.settings.labelDensity);ut(t,this.nodesWithForcedLabels),this.displayedNodeLabels=new Set;for(var n=this.canvasContexts.labels,r=0,i=t.length;r<i;r++){var a=t[r],o=this.nodeDataCache[a];if(!this.displayedNodeLabels.has(a)&&!o.hidden){var s=this.framedGraphToViewport(o),c=s.x,l=s.y,u=this.scaleSize(o.size);if(!(!o.forceLabel&&u<this.settings.labelRenderedSizeThreshold)&&!(c<-zt||c>this.width+zt||l<-Bt||l>this.height+Bt)){this.displayedNodeLabels.add(a);var d=this.settings.defaultDrawNodeLabel;(this.nodePrograms[o.type]?.drawLabel||d)(n,R(R({key:a},o),{},{size:u,x:c,y:l}),this.settings)}}}return this}},{key:`renderEdgeLabels`,value:function(){if(!this.settings.renderEdgeLabels)return this;var e=this.canvasContexts.edgeLabels;e.clearRect(0,0,this.width,this.height);var t=Rt({graph:this.graph,hoveredNode:this.hoveredNode,displayedNodeLabels:this.displayedNodeLabels,highlightedNodes:this.highlightedNodes});ut(t,this.edgesWithForcedLabels);for(var n=new Set,r=0,i=t.length;r<i;r++){var a=t[r],o=this.graph.extremities(a),s=this.nodeDataCache[o[0]],c=this.nodeDataCache[o[1]],l=this.edgeDataCache[a];if(!n.has(a)&&!(l.hidden||s.hidden||c.hidden)){var u=this.settings.defaultDrawEdgeLabel;(this.edgePrograms[l.type]?.drawLabel||u)(e,R(R({key:a},l),{},{size:this.scaleSize(l.size)}),R(R(R({key:o[0]},s),this.framedGraphToViewport(s)),{},{size:this.scaleSize(s.size)}),R(R(R({key:o[1]},c),this.framedGraphToViewport(c)),{},{size:this.scaleSize(c.size)}),this.settings),n.add(a)}}return this.displayedEdgeLabels=n,this}},{key:`renderHighlightedNodes`,value:function(){var e=this,t=this.canvasContexts.hovers;t.clearRect(0,0,this.width,this.height);var n=function(n){var r=e.nodeDataCache[n],i=e.framedGraphToViewport(r),a=i.x,o=i.y,s=e.scaleSize(r.size),c=e.settings.defaultDrawNodeHover;(e.nodePrograms[r.type]?.drawHover||c)(t,R(R({key:n},r),{},{size:s,x:a,y:o}),e.settings)},r=[];this.hoveredNode&&!this.nodeDataCache[this.hoveredNode].hidden&&r.push(this.hoveredNode),this.highlightedNodes.forEach(function(t){t!==e.hoveredNode&&r.push(t)}),r.forEach(function(e){return n(e)});var i={};for(var a in r.forEach(function(t){var n=e.nodeDataCache[t].type;i[n]=(i[n]||0)+1}),this.nodeHoverPrograms)this.nodeHoverPrograms[a].reallocate(i[a]||0),i[a]=0;r.forEach(function(t){var n=e.nodeDataCache[t];e.nodeHoverPrograms[n.type].process(0,i[n.type]++,n)}),this.webGLContexts.hoverNodes.clear(this.webGLContexts.hoverNodes.COLOR_BUFFER_BIT);var o=this.getRenderParams();for(var s in this.nodeHoverPrograms)this.nodeHoverPrograms[s].render(o)}},{key:`scheduleHighlightedNodesRender`,value:function(){var e=this;this.renderHighlightedNodesFrame||this.renderFrame||(this.renderHighlightedNodesFrame=requestAnimationFrame(function(){e.renderHighlightedNodesFrame=null,e.renderHighlightedNodes(),e.renderEdgeLabels()}))}},{key:`render`,value:function(){var e=this;this.emit(`beforeRender`);var t=function(){return e.emit(`afterRender`),e};if(this.renderFrame&&=(cancelAnimationFrame(this.renderFrame),null),this.resize(),this.needToProcess&&this.process(),this.needToProcess=!1,this.clear(),this.pickingLayers.forEach(function(t){return e.resetWebGLTexture(t)}),!this.graph.order)return t();var n=this.mouseCaptor,r=this.camera.isAnimated()||n.isMoving||n.draggedEvents||n.currentWheelDirection,i=this.camera.getState(),a=this.getDimensions(),o=this.getGraphDimensions(),s=this.getStagePadding();this.matrix=J(i,a,o,s),this.invMatrix=J(i,a,o,s,!0),this.correctionRatio=nt(this.matrix,i,a),this.graphToViewportRatio=this.getGraphToViewportRatio();var c=this.getRenderParams();for(var l in this.nodePrograms)this.nodePrograms[l].render(c);if(!this.settings.hideEdgesOnMove||!r)for(var u in this.edgePrograms)this.edgePrograms[u].render(c);return this.settings.hideLabelsOnMove&&r?t():(this.renderLabels(),this.renderEdgeLabels(),this.renderHighlightedNodes(),t())}},{key:`addNode`,value:function(e){var t=Object.assign({},this.graph.getNodeAttributes(e));this.settings.nodeReducer&&(t=this.settings.nodeReducer(e,t));var n=Vt(this.settings,e,t);this.nodeDataCache[e]=n,this.nodesWithForcedLabels.delete(e),n.forceLabel&&!n.hidden&&this.nodesWithForcedLabels.add(e),this.highlightedNodes.delete(e),n.highlighted&&!n.hidden&&this.highlightedNodes.add(e),this.settings.zIndex&&(n.zIndex<this.nodeZExtent[0]&&(this.nodeZExtent[0]=n.zIndex),n.zIndex>this.nodeZExtent[1]&&(this.nodeZExtent[1]=n.zIndex))}},{key:`updateNode`,value:function(e){this.addNode(e);var t=this.nodeDataCache[e];this.normalizationFunction.applyTo(t)}},{key:`removeNode`,value:function(e){delete this.nodeDataCache[e],delete this.nodeProgramIndex[e],this.highlightedNodes.delete(e),this.hoveredNode===e&&(this.hoveredNode=null),this.nodesWithForcedLabels.delete(e)}},{key:`addEdge`,value:function(e){var t=Object.assign({},this.graph.getEdgeAttributes(e));this.settings.edgeReducer&&(t=this.settings.edgeReducer(e,t));var n=Ht(this.settings,e,t);this.edgeDataCache[e]=n,this.edgesWithForcedLabels.delete(e),n.forceLabel&&!n.hidden&&this.edgesWithForcedLabels.add(e),this.settings.zIndex&&(n.zIndex<this.edgeZExtent[0]&&(this.edgeZExtent[0]=n.zIndex),n.zIndex>this.edgeZExtent[1]&&(this.edgeZExtent[1]=n.zIndex))}},{key:`updateEdge`,value:function(e){this.addEdge(e)}},{key:`removeEdge`,value:function(e){delete this.edgeDataCache[e],delete this.edgeProgramIndex[e],this.hoveredEdge===e&&(this.hoveredEdge=null),this.edgesWithForcedLabels.delete(e)}},{key:`clearNodeIndices`,value:function(){this.labelGrid=new Lt,this.nodeExtent={x:[0,1],y:[0,1]},this.nodeDataCache={},this.edgeProgramIndex={},this.nodesWithForcedLabels=new Set,this.nodeZExtent=[1/0,-1/0],this.highlightedNodes=new Set}},{key:`clearEdgeIndices`,value:function(){this.edgeDataCache={},this.edgeProgramIndex={},this.edgesWithForcedLabels=new Set,this.edgeZExtent=[1/0,-1/0]}},{key:`clearIndices`,value:function(){this.clearEdgeIndices(),this.clearNodeIndices()}},{key:`clearNodeState`,value:function(){this.displayedNodeLabels=new Set,this.highlightedNodes=new Set,this.hoveredNode=null}},{key:`clearEdgeState`,value:function(){this.displayedEdgeLabels=new Set,this.highlightedNodes=new Set,this.hoveredEdge=null}},{key:`clearState`,value:function(){this.clearEdgeState(),this.clearNodeState()}},{key:`addNodeToProgram`,value:function(e,t,n){var r=this.nodeDataCache[e],i=this.nodePrograms[r.type];if(!i)throw Error(`Sigma: could not find a suitable program for node type "${r.type}"!`);i.process(t,n,r),this.nodeProgramIndex[e]=n}},{key:`addEdgeToProgram`,value:function(e,t,n){var r=this.edgeDataCache[e],i=this.edgePrograms[r.type];if(!i)throw Error(`Sigma: could not find a suitable program for edge type "${r.type}"!`);var a=this.graph.extremities(e),o=this.nodeDataCache[a[0]],s=this.nodeDataCache[a[1]];i.process(t,n,o,s,r),this.edgeProgramIndex[e]=n}},{key:`getRenderParams`,value:function(){return{matrix:this.matrix,invMatrix:this.invMatrix,width:this.width,height:this.height,pixelRatio:this.pixelRatio,zoomRatio:this.camera.ratio,cameraAngle:this.camera.angle,sizeRatio:1/this.scaleSize(),correctionRatio:this.correctionRatio,downSizingRatio:this.pickingDownSizingRatio,minEdgeThickness:this.settings.minEdgeThickness,antiAliasingFeather:this.settings.antiAliasingFeather}}},{key:`getStagePadding`,value:function(){var e=this.settings,t=e.stagePadding;return e.autoRescale&&t||0}},{key:`createLayer`,value:function(e,t){var n=arguments.length>2&&arguments[2]!==void 0?arguments[2]:{};if(this.elements[e])throw Error(`Sigma: a layer named "${e}" already exists`);var r=at(t,{position:`absolute`},{class:`sigma-${e}`});return n.style&&Object.assign(r.style,n.style),this.elements[e]=r,`beforeLayer`in n&&n.beforeLayer?this.elements[n.beforeLayer].before(r):`afterLayer`in n&&n.afterLayer?this.elements[n.afterLayer].after(r):this.container.appendChild(r),r}},{key:`createCanvas`,value:function(e){var t=arguments.length>1&&arguments[1]!==void 0?arguments[1]:{};return this.createLayer(e,`canvas`,t)}},{key:`createCanvasContext`,value:function(e){var t=arguments.length>1&&arguments[1]!==void 0?arguments[1]:{},n=this.createCanvas(e,t),r={preserveDrawingBuffer:!1,antialias:!1};return this.canvasContexts[e]=n.getContext(`2d`,r),this}},{key:`createWebGLContext`,value:function(e){var t=arguments.length>1&&arguments[1]!==void 0?arguments[1]:{},n=t?.canvas||this.createCanvas(e,t);t.hidden&&n.remove();var r=R({preserveDrawingBuffer:!1,antialias:!1},t),i=n.getContext(`webgl2`,r);i||=n.getContext(`webgl`,r),i||=n.getContext(`experimental-webgl`,r);var a=i;if(this.webGLContexts[e]=a,a.blendFunc(a.ONE,a.ONE_MINUS_SRC_ALPHA),t.picking){this.pickingLayers.add(e);var o=a.createFramebuffer();if(!o)throw Error(`Sigma: cannot create a new frame buffer for layer ${e}`);this.frameBuffers[e]=o}return a}},{key:`killLayer`,value:function(e){var t=this.elements[e];if(!t)throw Error(`Sigma: cannot kill layer ${e}, which does not exist`);if(this.webGLContexts[e]){var n;(n=this.webGLContexts[e].getExtension(`WEBGL_lose_context`))==null||n.loseContext(),delete this.webGLContexts[e]}else this.canvasContexts[e]&&delete this.canvasContexts[e];return t.remove(),delete this.elements[e],this}},{key:`getCamera`,value:function(){return this.camera}},{key:`setCamera`,value:function(e){this.unbindCameraHandlers(),this.camera=e,this.bindCameraHandlers()}},{key:`getContainer`,value:function(){return this.container}},{key:`getGraph`,value:function(){return this.graph}},{key:`setGraph`,value:function(e){e!==this.graph&&(this.hoveredNode&&!e.hasNode(this.hoveredNode)&&(this.hoveredNode=null),this.hoveredEdge&&!e.hasEdge(this.hoveredEdge)&&(this.hoveredEdge=null),this.unbindGraphHandlers(),this.checkEdgesEventsFrame!==null&&(cancelAnimationFrame(this.checkEdgesEventsFrame),this.checkEdgesEventsFrame=null),this.graph=e,this.bindGraphHandlers(),this.refresh())}},{key:`getMouseCaptor`,value:function(){return this.mouseCaptor}},{key:`getTouchCaptor`,value:function(){return this.touchCaptor}},{key:`getDimensions`,value:function(){return{width:this.width,height:this.height}}},{key:`getGraphDimensions`,value:function(){var e=this.customBBox||this.nodeExtent;return{width:e.x[1]-e.x[0]||1,height:e.y[1]-e.y[0]||1}}},{key:`getNodeDisplayData`,value:function(e){var t=this.nodeDataCache[e];return t?Object.assign({},t):void 0}},{key:`getEdgeDisplayData`,value:function(e){var t=this.edgeDataCache[e];return t?Object.assign({},t):void 0}},{key:`getNodeDisplayedLabels`,value:function(){return new Set(this.displayedNodeLabels)}},{key:`getEdgeDisplayedLabels`,value:function(){return new Set(this.displayedEdgeLabels)}},{key:`getSettings`,value:function(){return R({},this.settings)}},{key:`getSetting`,value:function(e){return this.settings[e]}},{key:`setSetting`,value:function(e,t){var n=R({},this.settings);return this.settings[e]=t,ht(this.settings),this.handleSettingsUpdate(n),this.scheduleRefresh(),this}},{key:`updateSetting`,value:function(e,t){return this.setSetting(e,t(this.settings[e])),this}},{key:`setSettings`,value:function(e){var t=R({},this.settings);return this.settings=R(R({},this.settings),e),ht(this.settings),this.handleSettingsUpdate(t),this.scheduleRefresh(),this}},{key:`resize`,value:function(e){var t=this.width,n=this.height;if(this.width=this.container.offsetWidth,this.height=this.container.offsetHeight,this.pixelRatio=ot(),this.width===0){if(this.settings.allowInvalidContainer)this.width=1;else throw Error(`Sigma: Container has no width. You can set the allowInvalidContainer setting to true to stop seeing this error.`)}if(this.height===0){if(this.settings.allowInvalidContainer)this.height=1;else throw Error(`Sigma: Container has no height. You can set the allowInvalidContainer setting to true to stop seeing this error.`)}if(!e&&t===this.width&&n===this.height)return this;for(var r in this.elements){var i=this.elements[r];i.style.width=this.width+`px`,i.style.height=this.height+`px`}for(var a in this.canvasContexts)this.elements[a].setAttribute(`width`,this.width*this.pixelRatio+`px`),this.elements[a].setAttribute(`height`,this.height*this.pixelRatio+`px`),this.pixelRatio!==1&&this.canvasContexts[a].scale(this.pixelRatio,this.pixelRatio);for(var o in this.webGLContexts){this.elements[o].setAttribute(`width`,this.width*this.pixelRatio+`px`),this.elements[o].setAttribute(`height`,this.height*this.pixelRatio+`px`);var s=this.webGLContexts[o];if(s.viewport(0,0,this.width*this.pixelRatio,this.height*this.pixelRatio),this.pickingLayers.has(o)){var c=this.textures[o];c&&s.deleteTexture(c)}}return this.emit(`resize`),this}},{key:`clear`,value:function(){return this.emit(`beforeClear`),this.webGLContexts.nodes.bindFramebuffer(WebGLRenderingContext.FRAMEBUFFER,null),this.webGLContexts.nodes.clear(WebGLRenderingContext.COLOR_BUFFER_BIT),this.webGLContexts.edges.bindFramebuffer(WebGLRenderingContext.FRAMEBUFFER,null),this.webGLContexts.edges.clear(WebGLRenderingContext.COLOR_BUFFER_BIT),this.webGLContexts.hoverNodes.clear(WebGLRenderingContext.COLOR_BUFFER_BIT),this.canvasContexts.labels.clearRect(0,0,this.width,this.height),this.canvasContexts.hovers.clearRect(0,0,this.width,this.height),this.canvasContexts.edgeLabels.clearRect(0,0,this.width,this.height),this.emit(`afterClear`),this}},{key:`refresh`,value:function(e){var t=this,n=e?.skipIndexation!==void 0&&e?.skipIndexation,r=e?.schedule!==void 0&&e.schedule,i=!e||!e.partialGraph;if(i)this.clearEdgeIndices(),this.clearNodeIndices(),this.graph.forEachNode(function(e){return t.addNode(e)}),this.graph.forEachEdge(function(e){return t.addEdge(e)});else{for(var a,o=e.partialGraph?.nodes||[],s=0,c=o?.length||0;s<c;s++){var l=o[s];if(this.updateNode(l),n){var u=this.nodeProgramIndex[l];if(u===void 0)throw Error(`Sigma: node "${l}" can't be repaint`);this.addNodeToProgram(l,this.nodeIndices[l],u)}}for(var d=(e==null||(a=e.partialGraph)==null?void 0:a.edges)||[],f=0,p=d.length;f<p;f++){var m=d[f];if(this.updateEdge(m),n){var h=this.edgeProgramIndex[m];if(h===void 0)throw Error(`Sigma: edge "${m}" can't be repaint`);this.addEdgeToProgram(m,this.edgeIndices[m],h)}}}return(i||!n)&&(this.needToProcess=!0),r?this.scheduleRender():this.render(),this}},{key:`scheduleRender`,value:function(){var e=this;return this.renderFrame||=requestAnimationFrame(function(){e.render()}),this}},{key:`scheduleRefresh`,value:function(e){return this.refresh(R(R({},e),{},{schedule:!0}))}},{key:`getViewportZoomedState`,value:function(e,t){var n=this.camera.getState(),r=n.ratio,i=n.angle,a=n.x,o=n.y,s=this.settings,c=s.minCameraRatio,l=s.maxCameraRatio;typeof l==`number`&&(t=Math.min(t,l)),typeof c==`number`&&(t=Math.max(t,c));var u=t/r,d={x:this.width/2,y:this.height/2},f=this.viewportToFramedGraph(e),p=this.viewportToFramedGraph(d);return{angle:i,x:(f.x-p.x)*(1-u)+a,y:(f.y-p.y)*(1-u)+o,ratio:t}}},{key:`viewRectangle`,value:function(){var e=this.viewportToFramedGraph({x:0,y:0}),t=this.viewportToFramedGraph({x:this.width,y:0}),n=this.viewportToFramedGraph({x:0,y:this.height});return{x1:e.x,y1:e.y,x2:t.x,y2:t.y,height:t.y-n.y}}},{key:`framedGraphToViewport`,value:function(e){var t=arguments.length>1&&arguments[1]!==void 0?arguments[1]:{},n=!!t.cameraState||!!t.viewportDimensions||!!t.graphDimensions,r=et(t.matrix?t.matrix:n?J(t.cameraState||this.camera.getState(),t.viewportDimensions||this.getDimensions(),t.graphDimensions||this.getGraphDimensions(),t.padding||this.getStagePadding()):this.matrix,e);return{x:(1+r.x)*this.width/2,y:(1-r.y)*this.height/2}}},{key:`viewportToFramedGraph`,value:function(e){var t=arguments.length>1&&arguments[1]!==void 0?arguments[1]:{},n=!!t.cameraState||!!t.viewportDimensions||!t.graphDimensions,r=et(t.matrix?t.matrix:n?J(t.cameraState||this.camera.getState(),t.viewportDimensions||this.getDimensions(),t.graphDimensions||this.getGraphDimensions(),t.padding||this.getStagePadding(),!0):this.invMatrix,{x:e.x/this.width*2-1,y:1-e.y/this.height*2});return isNaN(r.x)&&(r.x=0),isNaN(r.y)&&(r.y=0),r}},{key:`viewportToGraph`,value:function(e){var t=arguments.length>1&&arguments[1]!==void 0?arguments[1]:{};return this.normalizationFunction.inverse(this.viewportToFramedGraph(e,t))}},{key:`graphToViewport`,value:function(e){var t=arguments.length>1&&arguments[1]!==void 0?arguments[1]:{};return this.framedGraphToViewport(this.normalizationFunction(e),t)}},{key:`getGraphToViewportRatio`,value:function(){var e={x:0,y:0},t={x:1,y:1},n=Math.sqrt((e.x-t.x)**2+(e.y-t.y)**2),r=this.graphToViewport(e),i=this.graphToViewport(t);return Math.sqrt((r.x-i.x)**2+(r.y-i.y)**2)/n}},{key:`getBBox`,value:function(){return this.nodeExtent}},{key:`getCustomBBox`,value:function(){return this.customBBox}},{key:`setCustomBBox`,value:function(e){return this.customBBox=e,this.scheduleRender(),this}},{key:`kill`,value:function(){this.emit(`kill`),this.removeAllListeners(),this.unbindCameraHandlers(),window.removeEventListener(`resize`,this.activeListeners.handleResize),this.mouseCaptor.kill(),this.touchCaptor.kill(),this.unbindGraphHandlers(),this.clearIndices(),this.clearState(),this.nodeDataCache={},this.edgeDataCache={},this.highlightedNodes.clear(),this.renderFrame&&=(cancelAnimationFrame(this.renderFrame),null),this.renderHighlightedNodesFrame&&=(cancelAnimationFrame(this.renderHighlightedNodesFrame),null);for(var e=this.container;e.firstChild;)e.removeChild(e.firstChild);for(var t in this.nodePrograms)this.nodePrograms[t].kill();for(var n in this.nodeHoverPrograms)this.nodeHoverPrograms[n].kill();for(var r in this.edgePrograms)this.edgePrograms[r].kill();for(var i in this.nodePrograms={},this.nodeHoverPrograms={},this.edgePrograms={},this.elements)this.killLayer(i);this.canvasContexts={},this.webGLContexts={},this.elements={}}},{key:`scaleSize`,value:function(){var e=arguments.length>0&&arguments[0]!==void 0?arguments[0]:1,t=arguments.length>1&&arguments[1]!==void 0?arguments[1]:this.camera.ratio;return e/this.settings.zoomToSizeRatioFunction(t)*(this.getSetting(`itemSizesReference`)===`positions`?t*this.graphToViewportRatio:1)}},{key:`getCanvases`,value:function(){var e={};for(var t in this.elements)this.elements[t]instanceof HTMLCanvasElement&&(e[t]=this.elements[t]);return e}}])}(qe),Wt=(0,a.createContext)(null),Gt=Wt.Provider;function Kt(){let e=(0,a.useContext)(Wt);if(e==null)throw Error(`No context provided: useSigmaContext() can only be used in a descendant of <SigmaContainer>`);return e}function qt(){return Kt().sigma}function Jt(){let{sigma:e}=Kt();return(0,a.useCallback)((t=>{e&&Object.keys(t).forEach((n=>{e.setSetting(n,t[n])}))}),[e])}function Yt(e){return new Set(Object.keys(e))}var Xt=Yt({clickNode:!0,rightClickNode:!0,downNode:!0,enterNode:!0,leaveNode:!0,doubleClickNode:!0,wheelNode:!0,clickEdge:!0,rightClickEdge:!0,downEdge:!0,enterEdge:!0,leaveEdge:!0,doubleClickEdge:!0,wheelEdge:!0,clickStage:!0,rightClickStage:!0,downStage:!0,doubleClickStage:!0,wheelStage:!0,beforeRender:!0,afterRender:!0,kill:!0,upStage:!0,upEdge:!0,upNode:!0,enterStage:!0,leaveStage:!0,resize:!0,afterClear:!0,afterProcess:!0,beforeClear:!0,beforeProcess:!0,moveBody:!0}),Zt=Yt({click:!0,rightClick:!0,doubleClick:!0,mouseup:!0,mousedown:!0,mousemove:!0,mousemovebody:!0,mouseleave:!0,mouseenter:!0,wheel:!0}),Qt=Yt({touchup:!0,touchdown:!0,touchmove:!0,touchmovebody:!0,tap:!0,doubletap:!0}),$t=Yt({updated:!0});function en(){let e=qt(),t=Jt(),[n,r]=(0,a.useState)({});return(0,a.useEffect)((()=>{if(!e||!n)return;let t=n,r=Object.keys(t);return r.forEach((n=>{let r=t[n];Xt.has(n)&&e.on(n,r),Zt.has(n)&&e.getMouseCaptor().on(n,r),Qt.has(n)&&e.getTouchCaptor().on(n,r),$t.has(n)&&e.getCamera().on(n,r)})),()=>{e&&r.forEach((n=>{let r=t[n];Xt.has(n)&&e.off(n,r),Zt.has(n)&&e.getMouseCaptor().off(n,r),Qt.has(n)&&e.getTouchCaptor().off(n,r),$t.has(n)&&e.getCamera().off(n,r)}))}}),[e,n,t]),r}function tn(){let e=qt();return(0,a.useCallback)(((t,n=!0)=>{e&&t&&(n&&e.getGraph().order>0&&e.getGraph().clear(),e.getGraph().import(t),e.refresh())}),[e])}function nn(e,t){if(e===t)return!0;if(typeof e==`object`&&e&&typeof t==`object`&&t){if(Object.keys(e).length!=Object.keys(t).length)return!1;for(let n in e)if(!Object.hasOwn(t,n)||!nn(e[n],t[n]))return!1;return!0}return!1}var rn=(0,a.forwardRef)((({graph:e,id:t,className:n,style:i,settings:o={},children:s},c)=>{let l=(0,a.useRef)(null),u=(0,a.useRef)(null),d={className:`react-sigma ${n||``}`,id:t,style:i},[f,p]=(0,a.useState)(null),[m,h]=(0,a.useState)(o);(0,a.useEffect)((()=>{h((e=>nn(e,o)?e:o))}),[o]),(0,a.useEffect)((()=>{let t=null;if(u.current!==null){let n=new r;e&&(n=typeof e==`function`?new e:e),t=new Ut(n,u.current,m),p((e=>{let n=null;return e&&(n=e.getCamera().getState()),n&&t.getCamera().setState(n),t}))}return()=>{t&&t.kill()}}),[u,e,m]),(0,a.useImperativeHandle)(c,(()=>f),[f]);let g=(0,a.useMemo)((()=>f&&l.current?{sigma:f,container:l.current}:null),[f,l]),_=g===null?null:a.createElement(Gt,{value:g},s);return a.createElement(`div`,Object.assign({},d,{ref:l}),a.createElement(`div`,{className:`sigma-container`,ref:u}),_)})),an=WebGLRenderingContext;an.UNSIGNED_BYTE,an.FLOAT;var on=`
attribute vec4 a_id;
attribute vec4 a_color;
attribute vec2 a_normal;
attribute float a_normalCoef;
attribute vec2 a_positionStart;
attribute vec2 a_positionEnd;
attribute float a_positionCoef;
attribute float a_sourceRadius;
attribute float a_targetRadius;
attribute float a_sourceRadiusCoef;
attribute float a_targetRadiusCoef;

uniform mat3 u_matrix;
uniform float u_zoomRatio;
uniform float u_sizeRatio;
uniform float u_pixelRatio;
uniform float u_correctionRatio;
uniform float u_minEdgeThickness;
uniform float u_lengthToThicknessRatio;
uniform float u_feather;

varying vec4 v_color;
varying vec2 v_normal;
varying float v_thickness;
varying float v_feather;

const float bias = 255.0 / 254.0;

void main() {
  float minThickness = u_minEdgeThickness;

  vec2 normal = a_normal * a_normalCoef;
  vec2 position = a_positionStart * (1.0 - a_positionCoef) + a_positionEnd * a_positionCoef;

  float normalLength = length(normal);
  vec2 unitNormal = normal / normalLength;

  // These first computations are taken from edge.vert.glsl. Please read it to
  // get better comments on what's happening:
  float pixelsThickness = max(normalLength, minThickness * u_sizeRatio);
  float webGLThickness = pixelsThickness * u_correctionRatio / u_sizeRatio;

  // Here, we move the point to leave space for the arrow heads:
  // Source arrow head
  float sourceRadius = a_sourceRadius * a_sourceRadiusCoef;
  float sourceDirection = sign(sourceRadius);
  float webGLSourceRadius = sourceDirection * sourceRadius * 2.0 * u_correctionRatio / u_sizeRatio;
  float webGLSourceArrowHeadLength = webGLThickness * u_lengthToThicknessRatio * 2.0;
  vec2 sourceCompensationVector =
    vec2(-sourceDirection * unitNormal.y, sourceDirection * unitNormal.x)
    * (webGLSourceRadius + webGLSourceArrowHeadLength);
    
  // Target arrow head
  float targetRadius = a_targetRadius * a_targetRadiusCoef;
  float targetDirection = sign(targetRadius);
  float webGLTargetRadius = targetDirection * targetRadius * 2.0 * u_correctionRatio / u_sizeRatio;
  float webGLTargetArrowHeadLength = webGLThickness * u_lengthToThicknessRatio * 2.0;
  vec2 targetCompensationVector =
  vec2(-targetDirection * unitNormal.y, targetDirection * unitNormal.x)
    * (webGLTargetRadius + webGLTargetArrowHeadLength);

  // Here is the proper position of the vertex
  gl_Position = vec4((u_matrix * vec3(position + unitNormal * webGLThickness + sourceCompensationVector + targetCompensationVector, 1)).xy, 0, 1);

  v_thickness = webGLThickness / u_zoomRatio;

  v_normal = unitNormal;

  v_feather = u_feather * u_correctionRatio / u_zoomRatio / u_pixelRatio * 2.0;

  #ifdef PICKING_MODE
  // For picking mode, we use the ID as the color:
  v_color = a_id;
  #else
  // For normal mode, we use the color:
  v_color = a_color;
  #endif

  v_color.a *= bias;
}
`,sn=WebGLRenderingContext,cn=sn.UNSIGNED_BYTE,Q=sn.FLOAT,ln=[`u_matrix`,`u_zoomRatio`,`u_sizeRatio`,`u_correctionRatio`,`u_pixelRatio`,`u_feather`,`u_minEdgeThickness`,`u_lengthToThicknessRatio`],un={lengthToThicknessRatio:U.lengthToThicknessRatio};function dn(e){var t=R(R({},un),e||{});return function(e){function n(){return c(this,n),h(this,n,arguments)}return _(n,e),u(n,[{key:`getDefinition`,value:function(){return{VERTICES:6,VERTEX_SHADER_SOURCE:on,FRAGMENT_SHADER_SOURCE:Me,METHOD:WebGLRenderingContext.TRIANGLES,UNIFORMS:ln,ATTRIBUTES:[{name:`a_positionStart`,size:2,type:Q},{name:`a_positionEnd`,size:2,type:Q},{name:`a_normal`,size:2,type:Q},{name:`a_color`,size:4,type:cn,normalized:!0},{name:`a_id`,size:4,type:cn,normalized:!0},{name:`a_sourceRadius`,size:1,type:Q},{name:`a_targetRadius`,size:1,type:Q}],CONSTANT_ATTRIBUTES:[{name:`a_positionCoef`,size:1,type:Q},{name:`a_normalCoef`,size:1,type:Q},{name:`a_sourceRadiusCoef`,size:1,type:Q},{name:`a_targetRadiusCoef`,size:1,type:Q}],CONSTANT_DATA:[[0,1,-1,0],[0,-1,1,0],[1,1,0,1],[1,1,0,1],[0,-1,1,0],[1,-1,0,-1]]}}},{key:`processVisibleItem`,value:function(e,t,n,r,i){var a=i.size||1,o=n.x,s=n.y,c=r.x,l=r.y,u=P(i.color),d=c-o,f=l-s,p=n.size||1,m=r.size||1,h=d*d+f*f,g=0,_=0;h&&(h=1/Math.sqrt(h),g=-f*h*a,_=d*h*a);var v=this.array;v[t++]=o,v[t++]=s,v[t++]=c,v[t++]=l,v[t++]=g,v[t++]=_,v[t++]=u,v[t++]=e,v[t++]=p,v[t++]=m}},{key:`setUniforms`,value:function(e,n){var r=n.gl,i=n.uniformLocations,a=i.u_matrix,o=i.u_zoomRatio,s=i.u_feather,c=i.u_pixelRatio,l=i.u_correctionRatio,u=i.u_sizeRatio,d=i.u_minEdgeThickness,f=i.u_lengthToThicknessRatio;r.uniformMatrix3fv(a,!1,e.matrix),r.uniform1f(o,e.zoomRatio),r.uniform1f(u,e.sizeRatio),r.uniform1f(l,e.correctionRatio),r.uniform1f(c,e.pixelRatio),r.uniform1f(s,e.antiAliasingFeather),r.uniform1f(d,e.minEdgeThickness),r.uniform1f(f,t.lengthToThicknessRatio)}}])}(H)}dn();function fn(e){return me([dn(e),je(e),je(R(R({},e),{},{extremity:`source`}))])}fn();var pn=`
precision mediump float;

varying vec4 v_color;

void main(void) {
  gl_FragColor = v_color;
}
`,mn=`
attribute vec4 a_id;
attribute vec4 a_color;
attribute vec2 a_position;

uniform mat3 u_matrix;

varying vec4 v_color;

const float bias = 255.0 / 254.0;

void main() {
  // Scale from [[-1 1] [-1 1]] to the container:
  gl_Position = vec4(
    (u_matrix * vec3(a_position, 1)).xy,
    0,
    1
  );

  #ifdef PICKING_MODE
  // For picking mode, we use the ID as the color:
  v_color = a_id;
  #else
  // For normal mode, we use the color:
  v_color = a_color;
  #endif

  v_color.a *= bias;
}
`,hn=WebGLRenderingContext,gn=hn.UNSIGNED_BYTE,_n=hn.FLOAT,vn=[`u_matrix`],yn=function(e){function t(){return c(this,t),h(this,t,arguments)}return _(t,e),u(t,[{key:`getDefinition`,value:function(){return{VERTICES:2,VERTEX_SHADER_SOURCE:mn,FRAGMENT_SHADER_SOURCE:pn,METHOD:WebGLRenderingContext.LINES,UNIFORMS:vn,ATTRIBUTES:[{name:`a_position`,size:2,type:_n},{name:`a_color`,size:4,type:gn,normalized:!0},{name:`a_id`,size:4,type:gn,normalized:!0}]}}},{key:`processVisibleItem`,value:function(e,t,n,r,i){var a=this.array,o=n.x,s=n.y,c=r.x,l=r.y,u=P(i.color);a[t++]=o,a[t++]=s,a[t++]=u,a[t++]=e,a[t++]=c,a[t++]=l,a[t++]=u,a[t++]=e}},{key:`setUniforms`,value:function(e,t){var n=t.gl,r=t.uniformLocations.u_matrix;n.uniformMatrix3fv(r,!1,e.matrix)}}])}(H),bn=WebGLRenderingContext;bn.UNSIGNED_BYTE,bn.FLOAT;function xn(e,t){if(typeof e!=`object`||!e)return e;var n=e[Symbol.toPrimitive];if(n!==void 0){var r=n.call(e,t||`default`);if(typeof r!=`object`)return r;throw TypeError(`@@toPrimitive must return a primitive value.`)}return(t===`string`?String:Number)(e)}function Sn(e){var t=xn(e,`string`);return typeof t==`symbol`?t:t+``}function Cn(e,t,n){return(t=Sn(t))in e?Object.defineProperty(e,t,{value:n,enumerable:!0,configurable:!0,writable:!0}):e[t]=n,e}function wn(e,t){var n=Object.keys(e);if(Object.getOwnPropertySymbols){var r=Object.getOwnPropertySymbols(e);t&&(r=r.filter(function(t){return Object.getOwnPropertyDescriptor(e,t).enumerable})),n.push.apply(n,r)}return n}function Tn(e){for(var t=1;t<arguments.length;t++){var n=arguments[t]==null?{}:arguments[t];t%2?wn(Object(n),!0).forEach(function(t){Cn(e,t,n[t])}):Object.getOwnPropertyDescriptors?Object.defineProperties(e,Object.getOwnPropertyDescriptors(n)):wn(Object(n)).forEach(function(t){Object.defineProperty(e,t,Object.getOwnPropertyDescriptor(n,t))})}return e}function En(e,t){if(!(e instanceof t))throw TypeError(`Cannot call a class as a function`)}function Dn(e,t){for(var n=0;n<t.length;n++){var r=t[n];r.enumerable=r.enumerable||!1,r.configurable=!0,`value`in r&&(r.writable=!0),Object.defineProperty(e,Sn(r.key),r)}}function On(e,t,n){return t&&Dn(e.prototype,t),n&&Dn(e,n),Object.defineProperty(e,"prototype",{writable:!1}),e}function kn(e){return kn=Object.setPrototypeOf?Object.getPrototypeOf.bind():function(e){return e.__proto__||Object.getPrototypeOf(e)},kn(e)}function An(){try{var e=!Boolean.prototype.valueOf.call(Reflect.construct(Boolean,[],function(){}))}catch{}return(An=function(){return!!e})()}function jn(e){if(e===void 0)throw ReferenceError(`this hasn't been initialised - super() hasn't been called`);return e}function Mn(e,t){if(t&&(typeof t==`object`||typeof t==`function`))return t;if(t!==void 0)throw TypeError(`Derived constructors may only return object or undefined`);return jn(e)}function Nn(e,t,n){return t=kn(t),Mn(e,An()?Reflect.construct(t,n||[],kn(e).constructor):t.apply(e,n))}function Pn(e,t){return Pn=Object.setPrototypeOf?Object.setPrototypeOf.bind():function(e,t){return e.__proto__=t,e},Pn(e,t)}function Fn(e,t){if(typeof t!=`function`&&t!==null)throw TypeError(`Super expression must either be null or a function`);e.prototype=Object.create(t&&t.prototype,{constructor:{value:e,writable:!0,configurable:!0}}),Object.defineProperty(e,"prototype",{writable:!1}),t&&Pn(e,t)}function In(e,t){(t==null||t>e.length)&&(t=e.length);for(var n=0,r=Array(t);n<t;n++)r[n]=e[n];return r}function Ln(e){if(Array.isArray(e))return In(e)}function Rn(e){if(typeof Symbol<`u`&&e[Symbol.iterator]!=null||e[`@@iterator`]!=null)return Array.from(e)}function zn(e,t){if(e){if(typeof e==`string`)return In(e,t);var n={}.toString.call(e).slice(8,-1);return n===`Object`&&e.constructor&&(n=e.constructor.name),n===`Map`||n===`Set`?Array.from(e):n===`Arguments`||/^(?:Ui|I)nt(?:8|16|32)(?:Clamped)?Array$/.test(n)?In(e,t):void 0}}function Bn(){throw TypeError(`Invalid attempt to spread non-iterable instance.
In order to be iterable, non-array objects must have a [Symbol.iterator]() method.`)}function Vn(e){return Ln(e)||Rn(e)||zn(e)||Bn()}function Hn(e,t,n,r){return{x:(1-e)**2*t.x+2*(1-e)*e*n.x+e**2*r.x,y:(1-e)**2*t.y+2*(1-e)*e*n.y+e**2*r.y}}function Un(e,t,n){for(var r=20,i=0,a=e,o=0;o<r;o++){var s=Hn((o+1)/r,e,t,n);i+=Math.sqrt((a.x-s.x)**2+(a.y-s.y)**2),a=s}return i}function Wn(e){var t=e.curvatureAttribute,n=e.defaultCurvature,r=e.keepLabelUpright,i=r===void 0||r;return function(e,r,a,o,s){var c=s.edgeLabelSize,l=r[t]||n,u=s.edgeLabelFont,d=s.edgeLabelWeight,f=s.edgeLabelColor.attribute?r[s.edgeLabelColor.attribute]||s.edgeLabelColor.color||`#000`:s.edgeLabelColor.color,p=r.label;if(p){e.fillStyle=f,e.font=`${d} ${c}px ${u}`;var m=!i||a.x<o.x,h=m?a.x:o.x,g=m?a.y:o.y,_=m?o.x:a.x,v=m?o.y:a.y,y=(h+_)/2,b=(g+v)/2,x=_-h,S=v-g,C=Math.sqrt(x**2+S**2),w=m?1:-1,T=y+S*l*w,E=b-x*l*w,D=r.size*.7+5,O={x:E-g,y:-(T-h)},k=Math.sqrt(O.x**2+O.y**2),A={x:v-E,y:-(_-T)},j=Math.sqrt(A.x**2+A.y**2);h+=D*O.x/k,g+=D*O.y/k,_+=D*A.x/j,v+=D*A.y/j,T+=D*S/C,E-=D*x/C;var M={x:T,y:E},N={x:h,y:g},P={x:_,y:v},F=Un(N,M,P);if(!(F<a.size+o.size)){var I=e.measureText(p).width,ee=F-a.size-o.size;if(I>ee){var te=`…`;for(p+=te,I=e.measureText(p).width;I>ee&&p.length>1;)p=p.slice(0,-2)+te,I=e.measureText(p).width;if(p.length<4)return}for(var L={},ne=0,R=p.length;ne<R;ne++){var re=p[ne];L[re]||(L[re]=e.measureText(re).width*(1+l*.35))}for(var z=.5-I/F/2,B=0,ie=p.length;B<ie;B++){var V=p[B],ae=Hn(z,N,M,P),oe=2*(1-z)*(T-h)+2*z*(_-T),se=2*(1-z)*(E-g)+2*z*(v-E),ce=Math.atan2(se,oe);e.save(),e.translate(ae.x,ae.y),e.rotate(ce),e.fillText(V,0,0),e.restore(),z+=L[V]/F}}}}}function Gn(e){var t=e.arrowHead,n=t?.extremity===`target`||t?.extremity===`both`,r=t?.extremity===`source`||t?.extremity===`both`;return`
precision highp float;

varying vec4 v_color;
varying float v_thickness;
varying float v_feather;
varying vec2 v_cpA;
varying vec2 v_cpB;
varying vec2 v_cpC;
${n?`
varying float v_targetSize;
varying vec2 v_targetPoint;`:``}
${r?`
varying float v_sourceSize;
varying vec2 v_sourcePoint;`:``}
${t?`
uniform float u_lengthToThicknessRatio;
uniform float u_widenessToThicknessRatio;`:``}

float det(vec2 a, vec2 b) {
  return a.x * b.y - b.x * a.y;
}

vec2 getDistanceVector(vec2 b0, vec2 b1, vec2 b2) {
  float a = det(b0, b2), b = 2.0 * det(b1, b0), d = 2.0 * det(b2, b1);
  float f = b * d - a * a;
  vec2 d21 = b2 - b1, d10 = b1 - b0, d20 = b2 - b0;
  vec2 gf = 2.0 * (b * d21 + d * d10 + a * d20);
  gf = vec2(gf.y, -gf.x);
  vec2 pp = -f * gf / dot(gf, gf);
  vec2 d0p = b0 - pp;
  float ap = det(d0p, d20), bp = 2.0 * det(d10, d0p);
  float t = clamp((ap + bp) / (2.0 * a + b + d), 0.0, 1.0);
  return mix(mix(b0, b1, t), mix(b1, b2, t), t);
}

float distToQuadraticBezierCurve(vec2 p, vec2 b0, vec2 b1, vec2 b2) {
  return length(getDistanceVector(b0 - p, b1 - p, b2 - p));
}

const vec4 transparent = vec4(0.0, 0.0, 0.0, 0.0);

void main(void) {
  float dist = distToQuadraticBezierCurve(gl_FragCoord.xy, v_cpA, v_cpB, v_cpC);
  float thickness = v_thickness;
${n?`
  float distToTarget = length(gl_FragCoord.xy - v_targetPoint);
  float targetArrowLength = v_targetSize + thickness * u_lengthToThicknessRatio;
  if (distToTarget < targetArrowLength) {
    thickness = (distToTarget - v_targetSize) / (targetArrowLength - v_targetSize) * u_widenessToThicknessRatio * thickness;
  }`:``}
${r?`
  float distToSource = length(gl_FragCoord.xy - v_sourcePoint);
  float sourceArrowLength = v_sourceSize + thickness * u_lengthToThicknessRatio;
  if (distToSource < sourceArrowLength) {
    thickness = (distToSource - v_sourceSize) / (sourceArrowLength - v_sourceSize) * u_widenessToThicknessRatio * thickness;
  }`:``}

  float halfThickness = thickness / 2.0;
  if (dist < halfThickness) {
    #ifdef PICKING_MODE
    gl_FragColor = v_color;
    #else
    float t = smoothstep(
      halfThickness - v_feather,
      halfThickness,
      dist
    );

    gl_FragColor = mix(v_color, transparent, t);
    #endif
  } else {
    gl_FragColor = transparent;
  }
}
`}function Kn(e){var t=e.arrowHead,n=t?.extremity===`target`||t?.extremity===`both`,r=t?.extremity===`source`||t?.extremity===`both`;return`
attribute vec4 a_id;
attribute vec4 a_color;
attribute float a_direction;
attribute float a_thickness;
attribute vec2 a_source;
attribute vec2 a_target;
attribute float a_current;
attribute float a_curvature;
${n?`attribute float a_targetSize;
`:``}
${r?`attribute float a_sourceSize;
`:``}

uniform mat3 u_matrix;
uniform float u_sizeRatio;
uniform float u_pixelRatio;
uniform vec2 u_dimensions;
uniform float u_minEdgeThickness;
uniform float u_feather;

varying vec4 v_color;
varying float v_thickness;
varying float v_feather;
varying vec2 v_cpA;
varying vec2 v_cpB;
varying vec2 v_cpC;
${n?`
varying float v_targetSize;
varying vec2 v_targetPoint;`:``}
${r?`
varying float v_sourceSize;
varying vec2 v_sourcePoint;`:``}
${t?`
uniform float u_widenessToThicknessRatio;`:``}

const float bias = 255.0 / 254.0;
const float epsilon = 0.7;

vec2 clipspaceToViewport(vec2 pos, vec2 dimensions) {
  return vec2(
    (pos.x + 1.0) * dimensions.x / 2.0,
    (pos.y + 1.0) * dimensions.y / 2.0
  );
}

vec2 viewportToClipspace(vec2 pos, vec2 dimensions) {
  return vec2(
    pos.x / dimensions.x * 2.0 - 1.0,
    pos.y / dimensions.y * 2.0 - 1.0
  );
}

void main() {
  float minThickness = u_minEdgeThickness;

  // Selecting the correct position
  // Branchless "position = a_source if a_current == 1.0 else a_target"
  vec2 position = a_source * max(0.0, a_current) + a_target * max(0.0, 1.0 - a_current);
  position = (u_matrix * vec3(position, 1)).xy;

  vec2 source = (u_matrix * vec3(a_source, 1)).xy;
  vec2 target = (u_matrix * vec3(a_target, 1)).xy;

  vec2 viewportPosition = clipspaceToViewport(position, u_dimensions);
  vec2 viewportSource = clipspaceToViewport(source, u_dimensions);
  vec2 viewportTarget = clipspaceToViewport(target, u_dimensions);

  vec2 delta = viewportTarget.xy - viewportSource.xy;
  float len = length(delta);
  vec2 normal = vec2(-delta.y, delta.x) * a_direction;
  vec2 unitNormal = normal / len;
  float boundingBoxThickness = len * a_curvature;

  float curveThickness = max(minThickness, a_thickness / u_sizeRatio);
  v_thickness = curveThickness * u_pixelRatio;
  v_feather = u_feather;

  v_cpA = viewportSource;
  v_cpB = 0.5 * (viewportSource + viewportTarget) + unitNormal * a_direction * boundingBoxThickness;
  v_cpC = viewportTarget;

  vec2 viewportOffsetPosition = (
    viewportPosition +
    unitNormal * (boundingBoxThickness / 2.0 + sign(boundingBoxThickness) * (${t?`curveThickness * u_widenessToThicknessRatio`:`curveThickness`} + epsilon)) *
    max(0.0, a_direction) // NOTE: cutting the bounding box in half to avoid overdraw
  );

  position = viewportToClipspace(viewportOffsetPosition, u_dimensions);
  gl_Position = vec4(position, 0, 1);
    
${n?`
  v_targetSize = a_targetSize * u_pixelRatio / u_sizeRatio;
  v_targetPoint = viewportTarget;
`:``}
${r?`
  v_sourceSize = a_sourceSize * u_pixelRatio / u_sizeRatio;
  v_sourcePoint = viewportSource;
`:``}

  #ifdef PICKING_MODE
  // For picking mode, we use the ID as the color:
  v_color = a_id;
  #else
  // For normal mode, we use the color:
  v_color = a_color;
  #endif

  v_color.a *= bias;
}
`}var qn=.25,Jn={arrowHead:null,curvatureAttribute:`curvature`,defaultCurvature:qn},Yn=WebGLRenderingContext,Xn=Yn.UNSIGNED_BYTE,$=Yn.FLOAT;function Zn(e){var t=Tn(Tn({},Jn),e||{}),n=t,r=n.arrowHead,i=n.curvatureAttribute,a=n.drawLabel,o=r?.extremity===`target`||r?.extremity===`both`,s=r?.extremity===`source`||r?.extremity===`both`,c=[`u_matrix`,`u_sizeRatio`,`u_dimensions`,`u_pixelRatio`,`u_feather`,`u_minEdgeThickness`].concat(Vn(r?[`u_lengthToThicknessRatio`,`u_widenessToThicknessRatio`]:[]));return function(e){Fn(n,e);function n(){var e;En(this,n);var r=[...arguments];return e=Nn(this,n,[].concat(r)),Cn(jn(e),`drawLabel`,a||Wn(t)),e}return On(n,[{key:`getDefinition`,value:function(){return{VERTICES:6,VERTEX_SHADER_SOURCE:Kn(t),FRAGMENT_SHADER_SOURCE:Gn(t),METHOD:WebGLRenderingContext.TRIANGLES,UNIFORMS:c,ATTRIBUTES:[{name:`a_source`,size:2,type:$},{name:`a_target`,size:2,type:$}].concat(Vn(o?[{name:`a_targetSize`,size:1,type:$}]:[]),Vn(s?[{name:`a_sourceSize`,size:1,type:$}]:[]),[{name:`a_thickness`,size:1,type:$},{name:`a_curvature`,size:1,type:$},{name:`a_color`,size:4,type:Xn,normalized:!0},{name:`a_id`,size:4,type:Xn,normalized:!0}]),CONSTANT_ATTRIBUTES:[{name:`a_current`,size:1,type:$},{name:`a_direction`,size:1,type:$}],CONSTANT_DATA:[[0,1],[0,-1],[1,1],[0,-1],[1,1],[1,-1]]}}},{key:`processVisibleItem`,value:function(e,t,n,r,a){var c=a.size||1,l=n.x,u=n.y,d=r.x,f=r.y,p=P(a.color),m=a[i]??qn,h=this.array;h[t++]=l,h[t++]=u,h[t++]=d,h[t++]=f,o&&(h[t++]=r.size),s&&(h[t++]=n.size),h[t++]=c,h[t++]=m,h[t++]=p,h[t++]=e}},{key:`setUniforms`,value:function(e,t){var n=t.gl,i=t.uniformLocations,a=i.u_matrix,o=i.u_pixelRatio,s=i.u_feather,c=i.u_sizeRatio,l=i.u_dimensions,u=i.u_minEdgeThickness;if(n.uniformMatrix3fv(a,!1,e.matrix),n.uniform1f(o,e.pixelRatio),n.uniform1f(c,e.sizeRatio),n.uniform1f(s,e.antiAliasingFeather),n.uniform2f(l,e.width*e.pixelRatio,e.height*e.pixelRatio),n.uniform1f(u,e.minEdgeThickness),r){var d=i.u_lengthToThicknessRatio,f=i.u_widenessToThicknessRatio;n.uniform1f(d,r.lengthToThicknessRatio),n.uniform1f(f,r.widenessToThicknessRatio)}}}]),n}(H)}var Qn=Zn();Zn({arrowHead:U}),Zn({arrowHead:Tn(Tn({},U),{},{extremity:`both`})});export{qt as a,ze as c,rn as i,yn as n,en as o,tn as r,Ve as s,Qn as t};