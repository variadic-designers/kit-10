# 3D Signed Distance Functions - the wisdom for making SDFs a primitive system

Research digest of Inigo Quilez's [*distance functions*](https://iquilezles.org/articles/distfunctions/)
(the canonical 3D-SDF reference), distilled with an eye toward **KIT•10 one day
modelling 3D content the way it models 2D UI today**: a flat tree of primitives
that a GPU turns into pixels.

The article is a catalogue + a small algebra. The catalogue is ~40 primitives.
The algebra is ~15 operators (booleans, transforms, repetition, deformations).
The wisdom is in the caveats about *which combinations stay correct* - that's the
part that decides whether an SDF-primitive system is a toy or an engine.

---

## 0. Why this matters to KIT•10 (read this first)

KIT•10 already resolves designs into a **flat `UiNode[]` tree** (Charter → Vellum),
and Vellum already leans on **SDF math for anti-aliasing** box borders/radii
(`fwidth`-based `aa_half` in `shader.wgsl`). So SDFs are not foreign here - the
2D renderer is *already* half an SDF renderer.

An SDF-primitive system is attractive for a design tool for four structural reasons:

1. **One representation for everything.** A scene is a single function
   `f(p: vec3) -> float` returning the signed distance to the nearest surface
   (negative inside). Every primitive, every boolean, every deformation composes
   into that one function. This is *exactly* the shape of a resolved KIT•10 tree:
   nodes + operators folding into one evaluable thing.
2. **Non-destructive CSG for free.** Union/subtract/intersect are `min`/`max`.
   A boolean is an operator node, not a baked mesh - so the design stays editable
   forever, which is KIT•10's whole thesis (resolution is derived, never baked).
3. **Smooth blends meshes can't do cheaply.** `smin` (smooth-minimum) gives
   organic fillets/welds between shapes with one extra parameter - a genuine
   design superpower that polygon booleans make painful.
4. **Resolution independence.** No tessellation. A sphere is perfect at any zoom,
   same as Vellum's rounded rects are today. Fits the "crisp at any zoom" bar the
   HiDPI/DPR work already set.

The cost: rendering shifts from **rasterizing quads** to **raymarching a field**
(sphere tracing in a fragment shader), and correctness hinges on the field being
a true (or safely-bounded) distance. The rest of this doc is the knowledge to get
that right.

> **Notation used throughout:** `dot2(v)` ≡ `dot(v,v)` (squared length). `p` is the
> sample point in the primitive's local space. Primitives are centred at the origin
> and axis-aligned unless the signature says otherwise - you *position* them by
> transforming `p` (see §5), not by baking coordinates in.

---

## 1. The core idea & the correctness ladder

A **signed distance function** returns, for any point `p`, the shortest distance
to the surface - positive outside, negative inside, zero on it. Three tiers of
"how true" a function is, and it governs everything downstream:

| Tier | Meaning | Safe to raymarch? |
|------|---------|-------------------|
| **Exact SDF** | Returns the real Euclidean distance everywhere. | Yes, full step size. |
| **Bound (lower bound)** | Never *over*-estimates distance (Lipschitz ≤ 1), but may under-estimate. | Yes, but you waste steps; still converges. |
| **Not a bound** | Can over-estimate → sphere tracing overshoots the surface → artifacts. | No - must shrink step size by hand. |

The single most important property is the **Lipschitz condition**: `|f(a) − f(b)| ≤ |a − b|`.
Sphere tracing marches `t += f(p)` and is only guaranteed not to tunnel through
geometry if `f` never grows faster than distance itself. **Every caveat below is
ultimately about preserving this.** IQ's repeated warning: many implementations
online are wrong precisely because an operator broke the bound.

---

## 2. Primitive catalogue

Verbatim GLSL. Grouped by whether they're **exact** or only a **bound** - a
distinction the article makes explicitly and that you must carry into any type
system that wraps these.

### 2.1 Exact / true SDFs

```glsl
float sdSphere( vec3 p, float r ) { return length(p) - r; }

float sdBox( vec3 p, vec3 b ) {
  vec3 q = abs(p) - b;
  return length(max(q,0.0)) + min(max(q.x,max(q.y,q.z)),0.0);
}

float sdRoundBox( vec3 p, vec3 b, float r ) {
  vec3 q = abs(p) - b + r;
  return length(max(q,0.0)) + min(max(q.x,max(q.y,q.z)),0.0) - r;
}

float sdBoxFrame( vec3 p, vec3 b, float e ) {
  p = abs(p) - b;
  vec3 q = abs(p+e)-e;
  return min(min(
    length(max(vec3(p.x,q.y,q.z),0.0))+min(max(p.x,max(q.y,q.z)),0.0),
    length(max(vec3(q.x,p.y,q.z),0.0))+min(max(q.x,max(p.y,q.z)),0.0)),
    length(max(vec3(q.x,q.y,p.z),0.0))+min(max(q.x,max(q.y,p.z)),0.0));
}

float sdTorus( vec3 p, vec2 t ) {
  vec2 q = vec2(length(p.xz)-t.x,p.y);
  return length(q)-t.y;
}

float sdCappedTorus( vec3 p, vec2 sc, float ra, float rb) {
  p.x = abs(p.x);
  float k = (sc.y*p.x>sc.x*p.y) ? dot(p.xy,sc) : length(p.xy);
  return sqrt( dot(p,p) + ra*ra - 2.0*ra*k ) - rb;
}

float sdLink( vec3 p, float le, float r1, float r2 ) {
  vec3 q = vec3( p.x, max(abs(p.y)-le,0.0), p.z );
  return length(vec2(length(q.xy)-r1,q.z)) - r2;
}

float sdCylinder( vec3 p, vec3 c ) { // infinite cylinder, c = (x,z offset, radius)
  return length(p.xz-c.xy)-c.z;
}

float sdCone( vec3 p, vec2 c, float h ) { // capped cone; c = normalized (sin,cos) of angle
  vec2 q = h*vec2(c.x/c.y,-1.0);
  vec2 w = vec2( length(p.xz), p.y );
  vec2 a = w - q*clamp( dot(w,q)/dot(q,q), 0.0, 1.0 );
  vec2 b = w - q*vec2( clamp( w.x/q.x, 0.0, 1.0 ), 1.0 );
  float k = sign( q.y );
  float d = min(dot( a, a ),dot(b, b));
  float s = max( k*(w.x*q.y-w.y*q.x),k*(w.y-q.y) );
  return sqrt(d)*sign(s);
}

float sdConeInfinite( vec3 p, vec2 c ) { // c = normalized (sin,cos)
  vec2 q = vec2( length(p.xz), -p.y );
  float d = length(q-c*max(dot(q,c), 0.0));
  return d * ((q.x*c.y-q.y*c.x<0.0)?-1.0:1.0);
}

float sdPlane( vec3 p, vec3 n, float h ) { // n must be normalized
  return dot(p,n) + h;
}

float sdHexPrism( vec3 p, vec2 h ) {
  const vec3 k = vec3(-0.8660254, 0.5, 0.57735);
  p = abs(p);
  p.xy -= 2.0*min(dot(k.xy, p.xy), 0.0)*k.xy;
  vec2 d = vec2(
    length(p.xy-vec2(clamp(p.x,-k.z*h.x,k.z*h.x), h.x))*sign(p.y-h.x),
    p.z-h.y );
  return min(max(d.x,d.y),0.0) + length(max(d,0.0));
}

float sdCapsule( vec3 p, vec3 a, vec3 b, float r ) { // segment a→b, radius r
  vec3 pa = p - a, ba = b - a;
  float h = clamp( dot(pa,ba)/dot(ba,ba), 0.0, 1.0 );
  return length( pa - ba*h ) - r;
}

float sdVerticalCapsule( vec3 p, float h, float r ) {
  p.y -= clamp( p.y, 0.0, h );
  return length( p ) - r;
}

float sdCappedCylinder( vec3 p, float r, float h ) { // vertical, half-height h
  vec2 d = abs(vec2(length(p.xz),p.y)) - vec2(r,h);
  return min(max(d.x,d.y),0.0) + length(max(d,0.0));
}

float sdCappedCylinderArb( vec3 p, vec3 a, vec3 b, float r ) {
  vec3 ba = b - a;
  vec3 pa = p - a;
  float baba = dot(ba,ba);
  float paba = dot(pa,ba);
  float x = length(pa*baba-ba*paba) - r*baba;
  float y = abs(paba-baba*0.5)-baba*0.5;
  float x2 = x*x;
  float y2 = y*y*baba;
  float d = (max(x,y)<0.0)?-min(x2,y2):(((x>0.0)?x2:0.0)+((y>0.0)?y2:0.0));
  return sign(d)*sqrt(abs(d))/baba;
}

float sdRoundedCylinder( vec3 p, float ra, float rb, float h ) {
  vec2 d = vec2( length(p.xz)-ra+rb, abs(p.y) - h + rb );
  return min(max(d.x,d.y),0.0) + length(max(d,0.0)) - rb;
}

float sdCappedCone( vec3 p, float h, float r1, float r2 ) {
  vec2 q = vec2( length(p.xz), p.y );
  vec2 k1 = vec2(r2,h);
  vec2 k2 = vec2(r2-r1,2.0*h);
  vec2 ca = vec2(q.x-min(q.x,(q.y<0.0)?r1:r2), abs(q.y)-h);
  vec2 cb = q - k1 + k2*clamp( dot(k1-q,k2)/dot2(k2), 0.0, 1.0 );
  float s = (cb.x<0.0 && ca.y<0.0) ? -1.0 : 1.0;
  return s*sqrt( min(dot2(ca),dot2(cb)) );
}

float sdCappedConeArb( vec3 p, vec3 a, vec3 b, float ra, float rb ) {
  float rba = rb-ra;
  float baba = dot(b-a,b-a);
  float papa = dot(p-a,p-a);
  float paba = dot(p-a,b-a)/baba;
  float x = sqrt( papa - paba*paba*baba );
  float cax = max(0.0,x-((paba<0.5)?ra:rb));
  float cay = abs(paba-0.5)-0.5;
  float k = rba*rba + baba;
  float f = clamp( (rba*(x-ra)+paba*baba)/k, 0.0, 1.0 );
  float cbx = x-ra - f*rba;
  float cby = paba - f;
  float s = (cbx<0.0 && cay<0.0) ? -1.0 : 1.0;
  return s*sqrt( min(cax*cax + cay*cay*baba, cbx*cbx + cby*cby*baba) );
}

float sdSolidAngle( vec3 p, vec2 c, float ra ) { // c = (sin,cos) of aperture
  vec2 q = vec2( length(p.xz), p.y );
  float l = length(q) - ra;
  float m = length(q - c*clamp(dot(q,c),0.0,ra) );
  return max(l,m*sign(c.y*q.x-c.x*q.y));
}

float sdCutSphere( vec3 p, float r, float h ) {
  float w = sqrt(r*r-h*h);
  vec2 q = vec2( length(p.xz), p.y );
  float s = max( (h-r)*q.x*q.x+w*w*(h+r-2.0*q.y), h*q.x-w*q.y );
  return (s<0.0) ? length(q)-r : (q.x<w) ? h - q.y : length(q-vec2(w,h));
}

float sdCutHollowSphere( vec3 p, float r, float h, float t ) {
  float w = sqrt(r*r-h*h);
  vec2 q = vec2( length(p.xz), p.y );
  return ((h*q.x<w*q.y) ? length(q-vec2(w,h)) : abs(length(q)-r) ) - t;
}

float sdDeathStar( vec3 p2, float ra, float rb, float d ) {
  float a = (ra*ra - rb*rb + d*d)/(2.0*d);
  float b = sqrt(max(ra*ra-a*a,0.0));
  vec2 p = vec2( p2.x, length(p2.yz) );
  if( p.x*b-p.y*a > d*max(b-p.y,0.0) ) return length(p-vec2(a,b));
  else return max( (length(p )-ra), -(length(p-vec2(d,0.0))-rb));
}

float sdRoundCone( vec3 p, float r1, float r2, float h ) {
  float b = (r1-r2)/h;
  float a = sqrt(1.0-b*b);
  vec2 q = vec2( length(p.xz), p.y );
  float k = dot(q,vec2(-b,a));
  if( k<0.0 ) return length(q) - r1;
  if( k>a*h ) return length(q-vec2(0.0,h)) - r2;
  return dot(q, vec2(a,b) ) - r1;
}

float sdRoundConeArb( vec3 p, vec3 a, vec3 b, float r1, float r2 ) {
  vec3 ba = b - a;
  float l2 = dot(ba,ba);
  float rr = r1 - r2;
  float a2 = l2 - rr*rr;
  float il2 = 1.0/l2;
  vec3 pa = p - a;
  float y = dot(pa,ba);
  float z = y - l2;
  float x2 = dot2( pa*l2 - ba*y );
  float y2 = y*y*l2;
  float z2 = z*z*l2;
  float k = sign(rr)*rr*rr*x2;
  if( sign(z)*a2*z2>k ) return sqrt(x2 + z2) *il2 - r2;
  if( sign(y)*a2*y2<k ) return sqrt(x2 + y2) *il2 - r1;
  return (sqrt(x2*a2*il2)+y*rr)*il2 - r1;
}

float sdVesicaSegment( in vec3 p, in vec3 a, in vec3 b, in float w ) {
  vec3 c = (a+b)*0.5;
  float l = length(b-a);
  vec3 v = (b-a)/l;
  float y = dot(p-c,v);
  vec2 q = vec2(length(p-c-y*v),abs(y));
  float r = 0.5*l;
  float d = 0.5*(r*r-w*w)/w;
  vec3 h = (r*q.x<d*(q.y-r)) ? vec3(0.0,r,0.0) : vec3(-d,0.0,d+w);
  return length(q-h.xy) - h.z;
}

float sdRhombus( vec3 p, float la, float lb, float h, float ra ) {
  p = abs(p);
  float f = clamp( (la*p.x-lb*p.z+lb*lb)/(la*la+lb*lb), 0.0, 1.0 );
  vec2 w = p.xz - vec2(la,lb)*vec2(f,1.0-f);
  vec2 q = vec2( length(w)*sign(w.x)-ra, p.y-h);
  return min(max(q.x,q.y),0.0) + length(max(q,0.0));
}

float sdOctahedron( vec3 p, float s ) { // EXACT
  p = abs(p);
  float m = p.x+p.y+p.z-s;
  vec3 q;
  if( 3.0*p.x < m ) q = p.xyz;
  else if( 3.0*p.y < m ) q = p.yzx;
  else if( 3.0*p.z < m ) q = p.zxy;
  else return m*0.57735027;
  float k = clamp(0.5*(q.z-q.y+s),0.0,s);
  return length(vec3(q.x,q.y-s+k,q.z-k));
}

float sdPyramid( vec3 p, float h ) {
  float m2 = h*h + 0.25;
  p.xz = abs(p.xz);
  p.xz = (p.z>p.x) ? p.zx : p.xz;
  p.xz -= 0.5;
  vec3 q = vec3( p.z, h*p.y - 0.5*p.x, h*p.x + 0.5*p.y);
  float s = max(-q.x,0.0);
  float t = clamp( (q.y-0.5*p.z)/(m2+0.25), 0.0, 1.0 );
  float a = m2*(q.x+s)*(q.x+s) + q.y*q.y;
  float b = m2*(q.x+0.5*t)*(q.x+0.5*t) + (q.y-m2*t)*(q.y-m2*t);
  float d2 = min(q.y,-q.x*m2-q.y*0.5) > 0.0 ? 0.0 : min(a,b);
  return sqrt( (d2+q.z*q.z)/m2 ) * sign(max(q.z,-p.y));
}
```

### 2.2 Unsigned distance surfaces (open geometry - `ud*`, no inside)

Triangles and quads are infinitely thin, so distance is unsigned. Useful as
building blocks; give them thickness with `opOnion`/`opRound` (§4).

```glsl
float udTriangle( vec3 p, vec3 a, vec3 b, vec3 c ) {
  vec3 ba = b - a; vec3 pa = p - a;
  vec3 cb = c - b; vec3 pb = p - b;
  vec3 ac = a - c; vec3 pc = p - c;
  vec3 nor = cross( ba, ac );
  return sqrt(
    (sign(dot(cross(ba,nor),pa)) +
     sign(dot(cross(cb,nor),pb)) +
     sign(dot(cross(ac,nor),pc))<2.0)
     ? min( min(
        dot2(ba*clamp(dot(ba,pa)/dot2(ba),0.0,1.0)-pa),
        dot2(cb*clamp(dot(cb,pb)/dot2(cb),0.0,1.0)-pb) ),
        dot2(ac*clamp(dot(ac,pc)/dot2(ac),0.0,1.0)-pc) )
     : dot(nor,pa)*dot(nor,pa)/dot2(nor) );
}

float udQuad( vec3 p, vec3 a, vec3 b, vec3 c, vec3 d ) {
  vec3 ba = b - a; vec3 pa = p - a;
  vec3 cb = c - b; vec3 pb = p - b;
  vec3 dc = d - c; vec3 pc = p - c;
  vec3 ad = a - d; vec3 pd = p - d;
  vec3 nor = cross( ba, ad );
  return sqrt(
    (sign(dot(cross(ba,nor),pa)) +
     sign(dot(cross(cb,nor),pb)) +
     sign(dot(cross(dc,nor),pc)) +
     sign(dot(cross(ad,nor),pd))<3.0)
     ? min( min( min(
        dot2(ba*clamp(dot(ba,pa)/dot2(ba),0.0,1.0)-pa),
        dot2(cb*clamp(dot(cb,pb)/dot2(cb),0.0,1.0)-pb) ),
        dot2(dc*clamp(dot(dc,pc)/dot2(dc),0.0,1.0)-pc) ),
        dot2(ad*clamp(dot(ad,pd)/dot2(ad),0.0,1.0)-pd) )
     : dot(nor,pa)*dot(nor,pa)/dot2(nor) );
}
```

### 2.3 Bounds only (NOT exact - mind the step size)

The article is explicit that these **do not return true distance**; they're lower
bounds. Fine to raymarch, but they under-report near the surface so you burn extra
steps, and combining them compounds the error.

```glsl
float sdEllipsoid( vec3 p, vec3 r ) { // lower bound - the classic "why is my ellipsoid wrong" shape
  float k0 = length(p/r);
  float k1 = length(p/(r*r));
  return k0*(k0-1.0)/k1;
}

float sdTriPrism( vec3 p, vec2 h ) { // lower bound
  vec3 q = abs(p);
  return max(q.z-h.y,max(q.x*0.866025+p.y*0.5,-p.y)-h.x*0.5);
}
```

> **Ellipsoid is the cautionary tale.** There is no known closed-form exact SDF for
> a general ellipsoid - the naive `length(p/r)-1.0` is *not even a bound* and will
> tunnel. The formula above is the best cheap lower bound. Lesson for a primitive
> system: **an ellipsoid is not a scaled sphere.** Non-uniform scale (§5) is the
> trap; a first-class ellipsoid primitive is the fix.

---

## 3. Bridging 2D → 3D (the natural growth path for KIT•10)

KIT•10 is 2D today. These two operators lift **any 2D SDF** into 3D - meaning the
rounded-rectangle field Vellum already computes for box corners could become a 3D
extruded panel with *no new primitive*, just a wrapper. This is the cheapest
possible on-ramp to 3D.

```glsl
// Spin a 2D shape around the Y axis at radius o.
float opRevolution( in vec3 p, in sdf2d primitive, in float o ) {
  vec2 q = vec2( length(p.xz) - o, p.y );
  return primitive(q);
}

// Give a 2D shape thickness ±h along Z.
float opExtrusion( in vec3 p, in sdf2d primitive, in float h ) {
  float d = primitive(p.xy);
  vec2 w = vec2( d, abs(p.z) - h );
  return min(max(w.x,w.y),0.0) + length(max(w,0.0));
}
```

**Implication:** a KIT•10 "SDF primitive" abstraction should treat 2D and 3D as one
family, with extrude/revolve as adapters - exactly how the current 2D box already
*is* a rounded-box SDF cross-section waiting to be extruded.

---

## 4. Deformations from a single SDF (`opRound`, `opOnion`, elongate, twist, bend, displace)

These take one primitive and warp it. Two flavours, and the distinction is the
whole game:

- **Surface warps that preserve the metric** (`opRound`, `opOnion`, `opElongate`) -
  stay exact/bounded, safe to march normally.
- **Space warps** (`opTwist`, `opCheapBend`, `opDisplace`) - **break the Lipschitz
  bound** because they compress space non-uniformly. Must reduce step size.

```glsl
// Inflate the surface outward by rad - turns any shape "rounded". Exact-preserving.
float opRound( in sdf3d primitive, in float rad ) {
  return primitive(p) - rad;
}

// Hollow shell of thickness `thickness`. Exact-preserving. (Layer repeatedly for onions.)
float opOnion( in float sdf, in float thickness ) {
  return abs(sdf)-thickness;
}

// Stretch a shape by inserting a box of "dead space" of half-extents h.
// Variant A is exact for 1 axis; variant B is a bound but works for all 3 axes.
float opElongate( in sdf3d primitive, in vec3 p, in vec3 h ) {
  vec3 q = p - clamp( p, -h, h );
  return primitive( q );
}
float opElongateB( in sdf3d primitive, in vec3 p, in vec3 h ) {
  vec3 q = abs(p)-h;
  return primitive( max(q,0.0) ) + min(max(q.x,max(q.y,q.z)),0.0);
}

// --- SPACE WARPS: break the bound, shrink step size proportionally to k ---

float opDisplace( in sdf3d primitive, in vec3 p ) {
  float d1 = primitive(p);
  float d2 = displacement(p);      // e.g. sin(freq*x)*sin(freq*y)*sin(freq*z)*amp
  return d1+d2;                     // add a field to perturb the surface
}

float opTwist( in sdf3d primitive, in vec3 p ) {
  const float k = 10.0;            // twist per unit height
  float c = cos(k*p.y);
  float s = sin(k*p.y);
  mat2  m = mat2(c,-s,s,c);
  vec3  q = vec3(m*p.xz,p.y);
  return primitive(q);
}

float opCheapBend( in sdf3d primitive, in vec3 p ) {
  const float k = 10.0;
  float c = cos(k*p.x);
  float s = sin(k*p.x);
  mat2  m = mat2(c,-s,s,c);
  vec3  q = vec3(m*p.xy,p.z);
  return primitive(q);
}
```

**Metric-change norms** (fake `length` to round edges cheaply - all lower bounds):

```glsl
float length2( vec3 p ){ p=p*p;             return sqrt(p.x+p.y+p.z); }
float length6( vec3 p ){ p=p*p*p; p=p*p;    return pow(p.x+p.y+p.z,1.0/6.0); }
float length8( vec3 p ){ p=p*p; p=p*p; p=p*p; return pow(p.x+p.y+p.z,1.0/8.0); }
```

---

## 5. Positioning, scaling, symmetry, repetition

**You transform the *point*, not the shape.** To place a primitive, feed it the
*inverse*-transformed sample point. This is the key mental flip from mesh/transform
thinking and it's what makes an SDF scene graph a tree of coordinate wrappers.

```glsl
// Rotate/translate: apply the inverse transform to p before evaluating.
vec3 opTx( in vec3 p, in transform t, in sdf3d primitive ) {
  return primitive( invert(t)*p );
}

// UNIFORM scale only. Divide in, multiply the result back out.
float opScale( in vec3 p, in float s, in sdf3d primitive ) {
  return primitive(p/s)*s;
}
```

> **Non-uniform scaling is impossible for a correct SDF.** Squashing one axis makes
> distances lie (the field is no longer Euclidean). This is a hard architectural
> constraint: **an SDF primitive system cannot expose a free `scale: vec3`.** You
> get non-uniform shapes by choosing a primitive that's parameterised that way
> (box half-extents, ellipsoid radii, capped-cone radii) - *not* by scaling a
> sphere. Bake this into the type system or users will produce broken fields.

**Mirror symmetry** - free, exact, halves your work (`abs()` folds space):

```glsl
float opSymX ( in vec3 p, in sdf3d primitive ){ p.x    = abs(p.x);  return primitive(p); }
float opSymXZ( in vec3 p, in sdf3d primitive ){ p.xz   = abs(p.xz); return primitive(p); }
```

**Repetition** - one primitive tiles infinite (or bounded) space for *zero* extra
storage. Huge for UI grids / arrays:

```glsl
// Infinite lattice with spacing s.
float opRepetition( in vec3 p, in vec3 s, in sdf3d primitive ) {
  vec3 q = p - s*round(p/s);
  return primitive( q );
}

// Bounded to ±l cells. NOTE: exact only when the primitive fits inside one cell;
// if it spills over, neighbouring copies interact and you must evaluate several.
vec3 opLimitedRepetition( in vec3 p, in float s, in vec3 l, in sdf3d primitive ) {
  vec3 q = p - s*clamp(round(p/s),-l,l);
  return primitive( q );
}
```

---

## 6. Combining primitives (CSG) - the algebra, and where it stays true

```glsl
float opUnion       ( float a, float b ){ return min(a,b); }
float opSubtraction ( float a, float b ){ return max(-a,b); } // b minus a
float opIntersection( float a, float b ){ return max(a,b); }
float opXor         ( float a, float b ){ return max(min(a,b),-max(a,b)); }
```

> **The correctness fault line, stated by IQ:** `min` (**Union**) and `Xor` produce a
> **true** SDF. `max` (**Subtraction**, **Intersection**) produce only a **bound** -
> the result under-reports distance near the seam where the two surfaces meet, so
> sphere tracing must be a touch more conservative around CSG cuts. Not fatal, but
> a system that pretends the output of a subtraction is exact will occasionally
> show artifacts. Track "exact vs bound" as a *propagated* property up the CSG tree,
> not just per-leaf.

**Smooth CSG (`smin`) - the design superpower.** `k` is the blend radius; larger
= softer weld. This is the current (quadratic, corrected) form from the article:

```glsl
float opSmoothUnion( float a, float b, float k ) {
  k *= 4.0;
  float h = max(k-abs(a-b),0.0);
  return min(a, b) - h*h*0.25/k;
}
float opSmoothSubtraction( float a, float b, float k ) { return -opSmoothUnion(a,-b,k); }
float opSmoothIntersection( float a, float b, float k ) { return -opSmoothUnion(-a,-b,k); }
```

Smooth-min also **breaks the exact bound** in the blend zone (it pulls the surface
inward), so the same step-size caution applies. It's worth it - organic fillets
between arbitrary shapes with one slider are something no polygon pipeline gives
you for free, and for a *design tool* that's a headline feature, not a footnote.

---

## 7. Companion techniques required to actually render (standard practice; adjacent IQ articles, not this page)

The distfunctions page defines the *field*. Turning it into pixels needs two more
pieces, universal enough to state here so this doc is self-contained. These are
**not** quoted from the page - they're the standard sphere-tracing setup.

**Sphere tracing (raymarch):** march along the ray, stepping by the current
distance, until you're within `eps` or exceed a max distance/step count.

```glsl
float raymarch( vec3 ro, vec3 rd ) {
  float t = 0.0;
  for( int i=0; i<128; i++ ) {
    vec3 p = ro + t*rd;
    float d = map(p);            // map() = your whole SDF scene
    if( d < 0.001 || t > 100.0 ) break;
    t += d;                      // the Lipschitz guarantee is what makes this safe
  }
  return t;
}
```

**Normals via the gradient** (tetrahedron technique - 4 evals, robust & cheap):

```glsl
vec3 calcNormal( vec3 p ) {
  const vec2 k = vec2(1.0,-1.0);
  const float h = 0.0005;
  return normalize(
    k.xyy*map(p + k.xyy*h) +
    k.yyx*map(p + k.yyx*h) +
    k.yxy*map(p + k.yxy*h) +
    k.xxx*map(p + k.xxx*h) );
}
```

Everything else (lighting, soft shadows via the same march, AO by sampling the
field along the normal) falls out of having `map()` + `calcNormal()`.

---

## 8. Distilled wisdom - the rules that matter for a primitive system

1. **The field is the model.** A scene = one function `map(p)->dist`. Design a
   KIT•10 SDF node tree so it *folds* into that function; that's the whole point,
   and it mirrors the existing resolved-`UiNode`-tree shape.
2. **Preserve the Lipschitz bound or pay for it.** Every operator either keeps
   distance ≤ true distance (safe, full-step) or doesn't (twist/bend/displace/smin/
   subtraction). **Propagate an `exact | bound | unbounded` flag up the tree** and
   let the raymarcher pick its step-size safety factor from the worst leaf.
3. **Transform the point, never the shape.** Positioning = inverse-transform `p`.
   Scaling = uniform only, divide-in-multiply-out.
4. **Ban non-uniform scale at the type level.** It cannot produce a correct SDF.
   Offer parameterised primitives (box extents, ellipsoid radii) instead. The
   ellipsoid isn't even exact - treat "no free vec3 scale" as a hard invariant.
5. **Prefer exact primitives + minimal distortion** over stacking approximate
   deformers. IQ: get as close as possible with true Euclidean primitives/ops,
   *then* apply the smallest distortion needed. Deformation is a garnish, not a base.
6. **2D and 3D are one family.** `opExtrusion`/`opRevolution` lift any 2D SDF to 3D.
   KIT•10's existing rounded-rect box field is already the seed of a 3D system.
7. **`min`/`max` are your CSG, `smin` is your differentiator.** Booleans are one
   line each; the smooth blends are the thing a *design* tool should surface as a
   first-class, sliderable operator.
8. **Repetition & symmetry are free geometry.** `abs()` and `round()` fold space -
   one primitive becomes a mirrored pair or an infinite grid at no storage cost.
   Directly relevant to arraying UI elements.
9. **`dot2(v) = dot(v,v)`** and the "two-part" `min(max(d.x,d.y),0)+length(max(d,0))`
   idiom (exterior + interior distance) recur across almost every exact primitive -
   learn that pattern once and most of the catalogue reads clearly.

---

## 9. Where this leaves KIT•10 / Vellum (opinion)

Vellum today rasterizes 2D quads and uses SDF math only for edge AA. A full 3D-SDF
engine is a *different renderer* (raymarched fragment pass), so this is far-future -
consistent with the "Vellum is preview-only; 3D is far-future courtesy" scope note.
But the shape of the migration is unusually clean **because the data model already
fits**:

- Charter's flat `UiNode[]` + parent indices is structurally a CSG/scene tree.
  An SDF backend would add primitive/operator node *kinds*, not a new architecture.
- Selection/hit-testing already exists (Vellum returns node ids, draws a selection
  overlay). Raymarching returns the nearest primitive id per pixel the same way -
  the selection model ports over.
- The correctness ladder (§1) wants an `exact|bound|unbounded` bit tracked per node
  and propagated - a small, well-defined addition to the wire format, and exactly
  the kind of "opinionated property Charter owns" the project already reasons about.
- The **cheapest first step is not 3D at all**: adopt SDF *evaluation* for the
  existing 2D primitives (Vellum is already partway there), prove out the
  field-as-model plumbing in 2D, then add `opExtrusion` as the literal first 3D node.

The single most important design decision, if this is ever built: **make "is this a
true distance" a tracked, propagated property of every node** - because that one bit
is what separates an SDF renderer that's robust from one that shimmers and tunnels,
and it has to live in the model, not be rediscovered in the shader.

---

## 10. Curated shape library - what KIT•10 actually exposes to users

§2's catalogue is ~33 functions, quoted verbatim because completeness matters for a
reference. But a design tool's shape picker is a UI surface, not a textbook - putting
all 33 in front of a user is noise, not power. Most of the catalogue is redundant
variants (arbitrary-orientation forms, once a node has its own position/rotation via
`opTx`) or single-purpose curios. This section consolidates §2 into what the picker
should actually offer, applying §8's own rules (#5 prefer exact primitives, #4 no
free `vec3` scale) as the filter.

### 10.1 Tier 1 - core set (ship first)

| Shape | Backing primitive | Exactness | Why it's core |
|---|---|---|---|
| Box | `sdBox` | exact | 3D sibling of the 2D box KIT•10 already has; corner rounding is a modifier (§10.4), not a separate shape |
| Sphere | `sdSphere` | exact | simplest solid; the canonical primitive |
| Cylinder | `sdCappedCylinder` | exact | common structural shape |
| Cone | `sdCappedCone` | exact | covers frustum/taper needs (a "capped cone" with `r1≈0` reads as a plain cone) |
| Torus | `sdTorus` | exact | the one genuinely non-convex "interesting" shape users will reach for |
| Capsule | `sdCapsule` (segment `a→b`, natively parameterized) | exact | pill shape, common in UI/badge/icon work |
| Pyramid | `sdPyramid` | exact | common structural shape |
| Plane | `sdPlane` | exact | backdrop/ground-catcher utility more than a "placed shape," but cheap and near-universally wanted for studio-style compositions |

### 10.2 Tier 2 - secondary set (add once Tier 1 ships and demand shows)

| Shape | Backing primitive | Exactness | Why it's secondary, not core |
|---|---|---|---|
| Rounded Cylinder | `sdRoundedCylinder` | exact | a Cylinder refinement; real but lower-frequency need |
| Round Cone | `sdRoundCone` | exact | smoothly-tapered cone/capsule hybrid, more specialized silhouette |
| Box Frame | `sdBoxFrame` | exact | hollow/wireframe look - popular in modern UI decoration, but a style choice more than a base shape |
| Octahedron | `sdOctahedron` (the exact branch - see §10.3 caution) | exact | diamond/gem silhouette, distinct enough from Box/Pyramid to earn a slot |
| Hex Prism | `sdHexPrism` | exact | common in badge/iconography work |
| Rhombus | `sdRhombus` | exact | diamond-plate silhouette |
| Cut Sphere / Cut Hollow Sphere | `sdCutSphere` / `sdCutHollowSphere` | exact | dome/bowl/shell shapes - genuinely useful for badges and UI chrome, but a compound idea (sphere + cut) rather than a first shape a user reaches for |

### 10.3 Excluded from the picker (with reasons - revisit only on a concrete need)

- **All "Arb" (arbitrary-endpoint) variants** (`sdCappedCylinderArb`, `sdCappedConeArb`,
  `sdRoundConeArb`) - **redundant by construction.** Every KIT•10 node already carries
  its own position + rotation (`opTx`, §5); a user orients the ordinary Tier-1/2
  primitive rather than needing a bespoke "from point A to point B" version of the
  same shape. The math stays available internally where a primitive is inherently
  segment-defined (Capsule already is), but never as a *distinct* picker entry -
  shipping both would just be two ways to do the same thing.
- **`sdCappedTorus`, `sdLink`, `sdSolidAngle`, `sdVesicaSegment`, `sdDeathStar`** -
  single-purpose curios (chain link, angular wedge, lens, crescent) that read as "one
  specific icon" rather than a general-purpose building block. Skip for v1; each is a
  candidate to add later only if a specific design need names it (e.g. an actual
  chain-link icon), not preemptively.
- **Infinite `sdCylinder` / `sdConeInfinite`** - only meaningful combined with a
  boolean cut; not independently placeable/resizable the way a shape picker expects.
  The capped versions (already Tier 1/2) cover the practical need.
- **`udTriangle` / `udQuad`** - unsigned (open, no inside/outside), need `opOnion`/
  `opRound` layered on top to become solid. Building blocks other primitives could
  compose from, not standalone picker shapes.
- **`sdOctahedron`'s bound/approximate branch** - the article gives an exact form
  (used above) and a cheaper bound approximation for distant/LOD rendering. KIT•10 has
  no LOD system; always use the exact branch. Flagged here so it isn't accidentally
  reached for as "the" octahedron formula later.
- **`sdEllipsoid`** - **flagged, not excluded outright.** Per §2.3, this is *not* an
  exact SDF, only a lower bound - and per §5, non-uniform scale is banned at the type
  level, so a first-class Ellipsoid primitive is the *only* legal way to get a
  stretched-sphere shape at all (you cannot fake it by scaling a Sphere). Real design
  value, real correctness cost. **Gate it behind the exact/bound propagation actually
  being implemented (§8 rule 2)** - do not ship it before the raymarcher can be
  conservative near a bound-only surface, or it will tunnel/shimmer.
- **`sdTriPrism`** - bound only, and its silhouette is already well covered by Box (+ a
  boolean cut) or Hex Prism's family. Not enough unique value to carry the step-size
  risk.

### 10.4 "Rounded" is a modifier, not a separate shape

Don't multiply the picker with a rounded variant of every entry (`sdBox` next to
`sdRoundBox`, etc.) - expose **one** corner/edge-rounding control per shape (`opRound`
generically, or a primitive's own native round parameter where it has one, e.g.
`sdRoundBox`/`sdRoundedCylinder`/`sdCappedCone`→`sdRoundCone`) rather than doubling
the shape count. This mirrors how the existing 2D box already has one radius control,
not "Box" and "Rounded Box" as two menu entries - same interaction model, one
dimension higher.

### 10.5 Net picker contents (Tier 1 + Tier 2)

Box, Sphere, Cylinder, Cone, Torus, Capsule, Pyramid, Plane, Rounded Cylinder, Round
Cone, Box Frame, Octahedron, Hex Prism, Rhombus, Cut Sphere, Cut Hollow Sphere - **16
shapes**, every one an exact SDF, out of §2's ~33. Ellipsoid is the one flagged
future addition once bound-propagation exists; everything else in §10.3 stays
excluded pending a concrete need.

---

*Source: Inigo Quilez, "distance functions" - https://iquilezles.org/articles/distfunctions/
(3D primitives, operators, deformations). §7 sphere-trace/normal snippets are standard
practice from IQ's raymarching material, flagged as not being on the distfunctions page.
All GLSL in §§2–6 is quoted verbatim from the article. §10 is original curation, not
from the source article.*
