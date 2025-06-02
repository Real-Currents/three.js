import { ArrayCamera } from '../../cameras/ArrayCamera.js';
import { EventDispatcher } from '../../core/EventDispatcher.js';
import { PerspectiveCamera } from '../../cameras/PerspectiveCamera.js';
import { Vector3 } from '../../math/Vector3.js';
import { Vector4 } from '../../math/Vector4.js';
import { WebGLAnimation } from '../webgl/WebGLAnimation.js';
import { WebXRController } from './WebXRController.js';
import { WebXRDepthSensing } from './WebXRDepthSensing.js';
import { WebGLRenderTarget } from "../WebGLRenderTarget";
import {
	DepthFormat,
	DepthStencilFormat,
	RGBAFormat,
	UnsignedByteType,
	UnsignedInt248Type,
	UnsignedIntType
} from "../../constants";
import { DepthTexture } from "../../textures/DepthTexture";
import { Vector2 } from "../../math/Vector2";

function WebXRManager( renderer, gl ) {

	const scope = this;

	let session = null;

	let framebufferScaleFactor = 1.0;

	let referenceSpace = null;
	let referenceSpaceType = 'local-floor';

	// Set default foveation to maximum.
	let foveation = 1.0;
	let customReferenceSpace = null;

	let pose = null;
	let glBinding = null;
	let glProjLayer = null;
	let glBaseLayer = null;
	let xrFrame = null;

	const depthSensing = new WebXRDepthSensing();
	const attributes = gl.getContextAttributes();

	let initialRenderTarget = null;
	let newRenderTarget = null;

	const controllers = [];
	const controllerInputSources = [];
	const inputSourcesMap = new Map();

	const currentSize = new Vector2();
	let currentPixelRatio = null;

	//

	const cameraL = new PerspectiveCamera();
	cameraL.layers.enable( 1 );
	cameraL.viewport = new Vector4();

	const cameraR = new PerspectiveCamera();
	cameraR.layers.enable( 2 );
	cameraR.viewport = new Vector4();

	const cameras = [ cameraL, cameraR ];

	const cameraVR = new ArrayCamera();
	cameraVR.layers.enable( 1 );
	cameraVR.layers.enable( 2 );

	let _currentDepthNear = null;
	let _currentDepthFar = null;

	//

	this.enabled = false;

	this.isPresenting = false;

	/**
	 * Returns a group representing the `target ray` space of the XR controller.
	 * Use this space for visualizing 3D objects that support the user in pointing
	 * tasks like UI interaction.
	 *
	 * @param {number} index - The index of the controller.
	 * @return {Group} A group representing the `target ray` space.
	 */
	this.getController = function ( index ) {

		let controller = controllers[ index ];

		if ( controller === undefined ) {

			controller = new WebXRController();
			controllers[ index ] = controller;

		}

		return controller.getTargetRaySpace();

	};

	/**
	 * Returns a group representing the `grip` space of the XR controller.
	 * Use this space for visualizing 3D objects that support the user in pointing
	 * tasks like UI interaction.
	 *
	 * Note: If you want to show something in the user's hand AND offer a
	 * pointing ray at the same time, you'll want to attached the handheld object
	 * to the group returned by `getControllerGrip()` and the ray to the
	 * group returned by `getController()`. The idea is to have two
	 * different groups in two different coordinate spaces for the same WebXR
	 * controller.
	 *
	 * @param {number} index - The index of the controller.
	 * @return {Group} A group representing the `grip` space.
	 */
	this.getControllerGrip = function ( index ) {

		let controller = controllers[ index ];

		if ( controller === undefined ) {

			controller = new WebXRController();
			controllers[ index ] = controller;

		}

		return controller.getGripSpace();

	};

	this.getHand = function ( index ) {

		let controller = controllers[ index ];

		if ( controller === undefined ) {

			controller = new WebXRController();
			controllers[ index ] = controller;

		}

		return controller.getHandSpace();

	};

	//

	function onSessionEvent( event ) {

		// const controller = inputSourcesMap.get( event.inputSource );
		const controllerIndex = controllerInputSources.indexOf( event.inputSource );

		if ( controllerIndex === - 1 ) {

			return;

		}

		const controller = controllers[ controllerIndex ];

		if ( controller !== undefined ) {

			controller.update( event.inputSource, event.frame, customReferenceSpace || referenceSpace );
			controller.dispatchEvent( { type: event.type, data: event.inputSource } );

		}

	}

	function onSessionEnd() {

		inputSourcesMap.forEach( function ( controller, inputSource ) {

			controller.disconnect( inputSource );

		} );

		inputSourcesMap.clear();

		//

		renderer.setFramebuffer( null );
		renderer.setRenderTarget( renderer.getRenderTarget() ); // Hack #15830
		animation.stop();

		scope.isPresenting = false;

		scope.dispatchEvent( { type: 'sessionend' } );

	}

	function onRequestReferenceSpace( value ) {

		referenceSpace = value;

		animation.setContext( session );
		animation.start();

		scope.isPresenting = true;

		scope.dispatchEvent( { type: 'sessionstart' } );

	}

	this.setFramebufferScaleFactor = function ( value ) {

		framebufferScaleFactor = value;

		if ( scope.isPresenting === true ) {

			console.warn( 'THREE.WebXRManager: Cannot change framebuffer scale while presenting.' );

		}

	};

	this.setReferenceSpaceType = function ( value ) {

		referenceSpaceType = value;

		if ( scope.isPresenting === true ) {

			console.warn( 'THREE.WebXRManager: Cannot change reference space type while presenting.' );

		}

	};

	this.getReferenceSpace = function () {

		return referenceSpace;

	};

	/**
	 * Returns the current XR session.
	 *
	 * @return {?XRSession} The XR session. Returns `null` when used outside a XR session.
	 */
	this.getSession = function () {

		return session;

	};

	/**
	 * After a XR session has been requested usually with one of the `*Button` modules, it
	 * is injected into the renderer with this method. This method triggers the start of
	 * the actual XR rendering.
	 *
	 * @async
	 * @param {XRSession} value - The XR session to set.
	 * @param {boolean} initWithLayers - Use WebXR Layers API (defaults to false)
	 * @return {Promise} A Promise that resolves when the session has been set.
	 */
	this.setSession = async function ( value, initWithLayers = false ) {

		session = value;

		if ( session !== null ) {

			initialRenderTarget = renderer.getRenderTarget();

			session.addEventListener( 'select', onSessionEvent );
			session.addEventListener( 'selectstart', onSessionEvent );
			session.addEventListener( 'selectend', onSessionEvent );
			session.addEventListener( 'squeeze', onSessionEvent );
			session.addEventListener( 'squeezestart', onSessionEvent );
			session.addEventListener( 'squeezeend', onSessionEvent );
			session.addEventListener( 'end', onSessionEnd );
			session.addEventListener( 'inputsourceschange', onInputSourcesChange );

			if ( attributes.xrCompatible !== true ) {

				await gl.makeXRCompatible();

			}

			currentPixelRatio = renderer.getPixelRatio();
			renderer.getSize( currentSize );

			const useLayers =  !!initWithLayers && (
				typeof XRWebGLBinding !== 'undefined'
				&& 'createProjectionLayer' in XRWebGLBinding.prototype
			);

			// if ( ! useLayers ) {
				const layerInit = {
					antialias: attributes.antialias,
					alpha: attributes.alpha,
					depth: attributes.depth,
					stencil: attributes.stencil,
					framebufferScaleFactor: framebufferScaleFactor
				};

				// // eslint-disable-next-line no-undef
				// const baseLayer = new XRWebGLLayer( session, gl, layerInit );
				//
				// session.updateRenderState( { baseLayer: baseLayer } );

				glBaseLayer = new XRWebGLLayer(session, gl, layerInit);

				session.updateRenderState({baseLayer: glBaseLayer});

				renderer.setPixelRatio(1);
				renderer.setSize(glBaseLayer.framebufferWidth, glBaseLayer.framebufferHeight, false);

				newRenderTarget = new WebGLRenderTarget(
					glBaseLayer.framebufferWidth,
					glBaseLayer.framebufferHeight,
					{
						format: RGBAFormat,
						type: UnsignedByteType,
						colorSpace: renderer.outputColorSpace,
						stencilBuffer: attributes.stencil,
						resolveDepthBuffer: (glBaseLayer.ignoreDepthValues === false),
						resolveStencilBuffer: (glBaseLayer.ignoreDepthValues === false)

					}
				);
			// }

			session.requestReferenceSpace( referenceSpaceType ).then( onRequestReferenceSpace );

			//

			session.addEventListener( 'inputsourceschange', updateInputSources );

		}

	};

	function updateInputSources( event ) {

		const inputSources = session.inputSources;

		// Assign inputSources to available controllers

		for ( let i = 0; i < controllers.length; i ++ ) {

			inputSourcesMap.set( inputSources[ i ], controllers[ i ] );

		}

		// Notify disconnected

		for ( let i = 0; i < event.removed.length; i ++ ) {

			const inputSource = event.removed[ i ];
			const controller = inputSourcesMap.get( inputSource );

			if ( controller ) {

				controller.dispatchEvent( { type: 'disconnected', data: inputSource } );
				inputSourcesMap.delete( inputSource );

			}

		}

		// Notify connected

		for ( let i = 0; i < event.added.length; i ++ ) {

			const inputSource = event.added[ i ];
			const controller = inputSourcesMap.get( inputSource );

			if ( controller ) {

				controller.dispatchEvent( { type: 'connected', data: inputSource } );

			}

		}

	}

	//

	const cameraLPos = new Vector3();
	const cameraRPos = new Vector3();

	/**
	 * Assumes 2 cameras that are parallel and share an X-axis, and that
	 * the cameras' projection and world matrices have already been set.
	 * And that near and far planes are identical for both cameras.
	 * Visualization of this technique: https://computergraphics.stackexchange.com/a/4765
	 */
	function setProjectionFromUnion( camera, cameraL, cameraR ) {

		cameraLPos.setFromMatrixPosition( cameraL.matrixWorld );
		cameraRPos.setFromMatrixPosition( cameraR.matrixWorld );

		const ipd = cameraLPos.distanceTo( cameraRPos );

		const projL = cameraL.projectionMatrix.elements;
		const projR = cameraR.projectionMatrix.elements;

		// VR systems will have identical far and near planes, and
		// most likely identical top and bottom frustum extents.
		// Use the left camera for these values.
		const near = projL[ 14 ] / ( projL[ 10 ] - 1 );
		const far = projL[ 14 ] / ( projL[ 10 ] + 1 );
		const topFov = ( projL[ 9 ] + 1 ) / projL[ 5 ];
		const bottomFov = ( projL[ 9 ] - 1 ) / projL[ 5 ];

		const leftFov = ( projL[ 8 ] - 1 ) / projL[ 0 ];
		const rightFov = ( projR[ 8 ] + 1 ) / projR[ 0 ];
		const left = near * leftFov;
		const right = near * rightFov;

		// Calculate the new camera's position offset from the
		// left camera. xOffset should be roughly half `ipd`.
		const zOffset = ipd / ( - leftFov + rightFov );
		const xOffset = zOffset * - leftFov;

		// TODO: Better way to apply this offset?
		cameraL.matrixWorld.decompose( camera.position, camera.quaternion, camera.scale );
		camera.translateX( xOffset );
		camera.translateZ( zOffset );
		camera.matrixWorld.compose( camera.position, camera.quaternion, camera.scale );
		camera.matrixWorldInverse.copy( camera.matrixWorld ).invert();

		// Find the union of the frustum values of the cameras and scale
		// the values so that the near plane's position does not change in world space,
		// although must now be relative to the new union camera.
		const near2 = near + zOffset;
		const far2 = far + zOffset;
		const left2 = left - xOffset;
		const right2 = right + ( ipd - xOffset );
		const top2 = topFov * far / far2 * near2;
		const bottom2 = bottomFov * far / far2 * near2;

		camera.projectionMatrix.makePerspective( left2, right2, top2, bottom2, near2, far2 );

	}

	function updateCamera( camera, parent ) {

		if ( parent === null ) {

			camera.matrixWorld.copy( camera.matrix );

		} else {

			camera.matrixWorld.multiplyMatrices( parent.matrixWorld, camera.matrix );

		}

		camera.matrixWorldInverse.copy( camera.matrixWorld ).invert();

	}

	this.getCamera = function ( camera ) {

		cameraVR.near = cameraR.near = cameraL.near = camera.near;
		cameraVR.far = cameraR.far = cameraL.far = camera.far;

		if ( _currentDepthNear !== cameraVR.near || _currentDepthFar !== cameraVR.far ) {

			// Note that the new renderState won't apply until the next frame. See #18320

			session.updateRenderState( {
				depthNear: cameraVR.near,
				depthFar: cameraVR.far
			} );

			_currentDepthNear = cameraVR.near;
			_currentDepthFar = cameraVR.far;

		}

		const parent = camera.parent;
		const cameras = cameraVR.cameras;

		updateCamera( cameraVR, parent );

		for ( let i = 0; i < cameras.length; i ++ ) {

			updateCamera( cameras[ i ], parent );

		}

		// update camera and its children

		camera.matrixWorld.copy( cameraVR.matrixWorld );

		const children = camera.children;

		for ( let i = 0, l = children.length; i < l; i ++ ) {

			children[ i ].updateMatrixWorld( true );

		}

		// update projection matrix for proper view frustum culling

		if ( cameras.length === 2 ) {

			setProjectionFromUnion( cameraVR, cameraL, cameraR );

		} else {

			// assume single camera setup (AR)

			cameraVR.projectionMatrix.copy( cameraL.projectionMatrix );

		}

		return cameraVR;

	};

	/**
	 * Returns the amount of foveation used by the XR compositor for the projection layer.
	 *
	 * @return {number} The amount of foveation.
	 */
	this.getFoveation = function () {

		if ( glProjLayer === null && glBaseLayer === null ) {

			return undefined;

		}

		return foveation;

	};

	/**
	 * Sets the foveation value.
	 *
	 * @param {number} value - A number in the range `[0,1]` where `0` means no foveation (full resolution)
	 * and `1` means maximum foveation (the edges render at lower resolution).
	 */
	this.setFoveation = function ( value ) {

		// 0 = no foveation = full resolution
		// 1 = maximum foveation = the edges render at lower resolution

		foveation = value;

		if ( glProjLayer !== null ) {

			glProjLayer.fixedFoveation = value;

		}

		if ( glBaseLayer !== null && glBaseLayer.fixedFoveation !== undefined ) {

			glBaseLayer.fixedFoveation = value;

		}

	};

	/**
	 * Returns the current depth texture computed via depth sensing.
	 *
	 * @return {?Texture} The depth texture.
	 */
	this.getDepthTexture = function () {

		return depthSensing.getDepthTexture();

	};

	function onInputSourcesChange( event ) {

		// Notify disconnected

		for ( let i = 0; i < event.removed.length; i ++ ) {

			const inputSource = event.removed[ i ];
			const index = controllerInputSources.indexOf( inputSource );

			if ( index >= 0 ) {

				controllerInputSources[ index ] = null;
				controllers[ index ].disconnect( inputSource );

			}

		}

		// Notify connected

		for ( let i = 0; i < event.added.length; i ++ ) {

			const inputSource = event.added[ i ];

			let controllerIndex = controllerInputSources.indexOf( inputSource );

			if ( controllerIndex === - 1 ) {

				// Assign input source a controller that currently has no input source

				for ( let i = 0; i < controllers.length; i ++ ) {

					if ( i >= controllerInputSources.length ) {

						controllerInputSources.push( inputSource );
						controllerIndex = i;
						break;

					} else if ( controllerInputSources[ i ] === null ) {

						controllerInputSources[ i ] = inputSource;
						controllerIndex = i;
						break;

					}

				}

				// If all controllers do currently receive input we ignore new ones

				if ( controllerIndex === - 1 ) break;

			}

			const controller = controllers[ controllerIndex ];

			if ( controller ) {

				controller.connect( inputSource );

			}

		}

	}

	// Animation Loop

	let onAnimationFrameCallback = null;

	function onAnimationFrame( time, frame ) {

		pose = frame.getViewerPose( referenceSpace );

		if ( pose !== null ) {

			const views = pose.views;
			const baseLayer = session.renderState.baseLayer;

			renderer.setFramebuffer( baseLayer.framebuffer );

			let cameraVRNeedsUpdate = false;

			// check if it's necessary to rebuild cameraVR's camera list

			if ( views.length !== cameraVR.cameras.length ) {

				cameraVR.cameras.length = 0;
				cameraVRNeedsUpdate = true;

			}

			for ( let i = 0; i < views.length; i ++ ) {

				const view = views[ i ];
				const viewport = baseLayer.getViewport( view );

				const camera = cameras[ i ];
				camera.matrix.fromArray( view.transform.matrix );
				camera.projectionMatrix.fromArray( view.projectionMatrix );
				camera.viewport.set( viewport.x, viewport.y, viewport.width, viewport.height );

				if ( i === 0 ) {

					cameraVR.matrix.copy( camera.matrix );

				}

				if ( cameraVRNeedsUpdate === true ) {

					cameraVR.cameras.push( camera );

				}

			}

		}

		//

		const inputSources = session.inputSources;

		for ( let i = 0; i < controllers.length; i ++ ) {

			const controller = controllers[ i ];
			const inputSource = inputSources[ i ];

			controller.update( inputSource, frame, referenceSpace );

		}

		if ( onAnimationFrameCallback ) onAnimationFrameCallback( time, frame );

	}

	const animation = new WebGLAnimation();
	animation.setAnimationLoop( onAnimationFrame );

	this.setAnimationLoop = function ( callback ) {

		onAnimationFrameCallback = callback;

	};

	this.dispose = function () {};

}

Object.assign( WebXRManager.prototype, EventDispatcher.prototype );

export { WebXRManager };
