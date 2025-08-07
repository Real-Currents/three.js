import {
	CanvasTexture,
	LinearFilter,
	Mesh,
	MeshBasicMaterial,
	PlaneGeometry,
	SRGBColorSpace,
	Color
} from '../../../src/Three';

export class HTMLMesh extends Mesh {
	constructor(dom: HTMLElement);
	dispose(): void;
}

export class HTMLTexture extends CanvasTexture {
	dom: HTMLElement;
	observer: MutationObserver;
	scheduleUpdate: number | null;
	
	constructor(dom: HTMLElement);
	dispatchDOMEvent(event: { type: string; data?: { x: number; y: number } }): void;
	update(): void;
	dispose(): void;
}

export function html2canvas(element: HTMLElement): HTMLCanvasElement;
export function htmlevent(element: HTMLElement, event: string, x: number, y: number): void;
