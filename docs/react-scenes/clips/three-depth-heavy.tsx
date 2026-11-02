import { Layer, useTimeline } from 'revline';
import { ThreeLayer, useThree } from 'revline/three';
import * as THREE from 'three';
import { useMemo } from 'react';

function Sculpture() {
  const material = useMemo(() => new THREE.MeshStandardMaterial({ color: '#b8c2ad', roughness: .7, metalness: .1 }), []);
  const { camera } = useThree();
  const ref = useTimeline<THREE.Group>((tl, group) => {
    tl.to(group.rotation, { y: .9, x: .2, duration: 4, ease: 'power2.inOut' }, 0);
    tl.to(camera.position, { z: 5.3, x: .3, duration: 4, ease: 'power2.inOut' }, '<');
  });
  return <group ref={ref} position={[1.45, 0, 0]} rotation={[.18, -.35, -.12]}>
    <mesh><torusKnotGeometry args={[.72, .22, 96, 12]} /><meshStandardMaterial color="#d8bd79" roughness={.55} metalness={.2} /></mesh>
    {Array.from({length: 96}, (_, i) => <mesh key={i} material={material} position={[(i % 12 - 5.5) * .25, (Math.floor(i / 12) - 3.5) * .25, -.8 - (i % 3) * .1]}><sphereGeometry args={[.11, 32, 24]} /></mesh>)}
    <mesh position={[0, -1.3, -.2]} rotation={[-Math.PI / 2, 0, 0]}><circleGeometry args={[1.35, 48]} /><meshBasicMaterial color="#31312e" /></mesh>
    <mesh position={[-1.05, .9, -.7]}><sphereGeometry args={[.18, 16, 12]} /><meshStandardMaterial color="#d4d1c4" roughness={.7} /></mesh>
  </group>;
}

export default function Scene() {
  const ref = useTimeline((tl, el) => {
    tl.from(el.querySelector('h1'), { y: 30, opacity: 0, duration: .8, ease: 'power3.out' }, 0);
  });
  return <Layer ref={ref} style={{ background: '#202020' }}>
    <ThreeLayer camera={{ position: [0, 0, 6], fov: 40 }}>
      <ambientLight intensity={.9} />
      <directionalLight position={[3, 4, 5]} intensity={2.2} />
      <directionalLight position={[-3, 1, -2]} intensity={1.1} color="#fff0d0" />
      <Sculpture />
    </ThreeLayer>
    <Layer style={{ padding: 120, boxSizing: 'border-box', pointerEvents: 'none' }}>
      <div style={{ font: '500 24px Space Grotesk', color: '#b4b4ac', letterSpacing: 5 }}>REVLINE / MOTION STUDY</div>
      <h1 style={{ font: '500 112px/1.05 Space Grotesk', maxWidth: 800, marginTop: 60 }}>A little<br />perspective.</h1>
      <div style={{ position: 'absolute', bottom: 110, fontSize: 28, color: '#b4b4ac' }}>GSAP + THREE.JS</div>
    </Layer>
  </Layer>;
}
