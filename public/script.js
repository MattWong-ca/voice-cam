const App = () => {
	const visualizerRef = React.useRef(null);
	const [images, setImages] = React.useState([]);
	const [lastImageUrl, setLastImageUrl] = React.useState(null);
	const lastImageUrlRef = React.useRef();
	lastImageUrlRef.current = lastImageUrl;
	const [audios, setAudios] = React.useState([]);
	const [isGenerating, setIsGenerating] = React.useState(false);
	const [isWebcamOpen, setIsWebcamOpen] = React.useState(false);
	const [isCommandsOpen, setIsCommandsOpen] = React.useState(() => {
		const stored = localStorage.getItem('isCommandsOpen');
		return stored !== null ? JSON.parse(stored) : true;
	});

	React.useEffect(() => {
		localStorage.setItem('isCommandsOpen', JSON.stringify(isCommandsOpen));
	}, [isCommandsOpen]);

	const handleNewImage = (imageUrl) => {
		setLastImageUrl(imageUrl);
		setImages(prevImages => [imageUrl, ...prevImages]);
		setIsWebcamOpen(false);
	};

	const fns = React.useMemo(() => ({
		// getPageHTML: {
		// 	description: 'Gets the HTML for the current page',
		// 	fn: () => {
		// 		return { success: true, html: document.documentElement.outerHTML };
		// 	}
		// },
		// changeBackgroundColor: {
		// 	description: 'Changes the background color of the page',
		// 	examplePrompt: 'Change the background to the color of the sky',
		// 	parameters: {
		// 		type: 'object',
		// 		properties: {
		// 			color: { type: 'string', description: 'A hex value of the color' },
		// 		},
		// 	},
		// 	fn: ({ color }) => {
		// 		document.documentElement.style.setProperty('--background-color', color);
		// 		return { success: true, color };
		// 	}
		// },
		// changeTextColor: {
		// 	description: 'Change the text color of the page',
		// 	examplePrompt: 'Change the text to the color of a polar bear',
		// 	parameters: {
		// 		type: 'object',
		// 		properties: {
		// 			color: { type: 'string', description: 'A hex value of the color' },
		// 		},
		// 	},
		// 	fn: ({ color }) => {
		// 		document.documentElement.style.setProperty('--text-color', color);
		// 		return { success: true, color };
		// 	}
		// },
		generateImage: {
			description: 'Generate an image and display it on the page',
			examplePrompt: 'Make a linocut of a raccoon wearing spectacles',
			parameters: {
				type: 'object',
				properties: {
					prompt: { type: 'string', description: 'Text description of the image to generate' }
				}
			},
			fn: async ({ prompt }) => {
				console.log('generateImage', prompt);
				setIsGenerating(true);
				try {
					const imageUrl = await fetch('/generate-image', {
						method: 'POST',
						body: prompt,
					}).then((r) => r.text());

					console.log('imageUrl', imageUrl);
					
					setLastImageUrl(imageUrl);
					setImages(prevImages => [imageUrl, ...prevImages]);

					return { success: true, imageUrl };
				} finally {
					setIsGenerating(false);
				}
			}
		},
		editImage: {
			description: 'Edit the last generated image based on a text prompt',
			examplePrompt: 'Put a beanie on the raccoon',
			parameters: {
				type: 'object',
				properties: {
					prompt: { type: 'string', description: 'Text description of how to edit the image' }
				}
			},
			fn: async ({ prompt }) => {
				if (!lastImageUrlRef.current) {
					return { success: false, error: 'No image to edit. Please generate an image first.' };
				}
				console.log('editImage', prompt, lastImageUrlRef.current);
				setIsGenerating(true);
				try {
					const imageUrl = await fetch('/edit-image', {
						method: 'POST',
						headers: {
							'Content-Type': 'application/json',
						},
						body: JSON.stringify({ prompt, imageUrl: lastImageUrlRef.current }),
					}).then((r) => r.text());

					console.log('new imageUrl', imageUrl);
					
					setLastImageUrl(imageUrl);
					setImages(prevImages => [imageUrl, ...prevImages]);

					return { success: true, imageUrl };
				} finally {
					setIsGenerating(false);
				}
			}
		},
		takePicture: {
			description: 'Take a picture using the webcam',
			examplePrompt: 'Take a photo using my webcam',
			parameters: {
				type: 'object',
				properties: {}
			},
			fn: () => {
				console.log('takePicture');
				// Trigger the capture function in WebcamCapture component
				if (window.triggerCapture) {
					window.triggerCapture();
					return { success: true, message: 'Photo captured!' };
				} else {
					return { success: false, error: 'Camera not available.' };
				}
			}
		}
	}), []);

	const tools = React.useMemo(() => Object.entries(fns).map(([name, { fn, examplePrompt, ...tool }]) => ({
		type: 'function',
		name,
		...tool
	})), [fns]);

	React.useEffect(() => {
		console.log('tools', tools);

		const peerConnection = new RTCPeerConnection();

		peerConnection.ontrack = (event) => {
			const stream = event.streams[0];
			setAudios(prevAudios => [...prevAudios, stream]);
		};

		const dataChannel = peerConnection.createDataChannel('response');

		function configureData() {
			console.log('Configuring data channel');
			const event = {
				type: 'session.update',
				session: {
					modalities: ['text', 'audio'],
					tools
				},
			};
			dataChannel.send(JSON.stringify(event));
		}

		dataChannel.addEventListener('open', (ev) => {
			console.log('Opening data channel', ev);
			configureData();
		});

		dataChannel.addEventListener('message', async (ev) => {
			const msg = JSON.parse(ev.data);
			if (msg.type === 'response.function_call_arguments.done') {
				const { fn } = fns[msg.name];
				if (fn !== undefined) {
					console.log(`Calling local function ${msg.name} with ${msg.arguments}`);
					const args = JSON.parse(msg.arguments);
					const result = await fn(args);
					console.log('result', result);
					const event = {
						type: 'conversation.item.create',
						item: {
							type: 'function_call_output',
							call_id: msg.call_id,
							output: JSON.stringify(result),
						},
					};
					dataChannel.send(JSON.stringify(event));
				}
			}
		});

		function visualize(stream) {
			const canvas = visualizerRef.current;
			if (!canvas) return;
			const canvasCtx = canvas.getContext('2d');

			const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
			const source = audioCtx.createMediaStreamSource(stream);
			const analyser = audioCtx.createAnalyser();
			analyser.fftSize = 2048;
			source.connect(analyser);

			const bufferLength = analyser.frequencyBinCount;
			const dataArray = new Uint8Array(bufferLength);

			canvasCtx.clearRect(0, 0, canvas.width, canvas.height);

			function draw() {
				requestAnimationFrame(draw);
				analyser.getByteTimeDomainData(dataArray);
				canvasCtx.fillStyle = getComputedStyle(document.documentElement).getPropertyValue('--background-color') || 'rgb(243 244 246)';
				canvasCtx.fillRect(0, 0, canvas.width, canvas.height);
				canvasCtx.lineWidth = 2;

				const textColor = getComputedStyle(document.documentElement).getPropertyValue('--text-color') || 'rgb(17, 24, 39)';
				const rgb = textColor.match(/\d+/g);
				let r = 17, g = 24, b = 39;
				if (rgb && rgb.length >= 3) {
					[r, g, b] = rgb.map(Number);
				}
				
				const gradient = canvasCtx.createLinearGradient(0, 0, canvas.width, 0);
				gradient.addColorStop(0, `rgba(${r}, ${g}, ${b}, 0)`);
				gradient.addColorStop(0.1, `rgba(${r}, ${g}, ${b}, 1)`);
				gradient.addColorStop(0.9, `rgba(${r}, ${g}, ${b}, 1)`);
				gradient.addColorStop(1, `rgba(${r}, ${g}, ${b}, 0)`);
				canvasCtx.strokeStyle = gradient;

				canvasCtx.beginPath();
				const sliceWidth = canvas.width * 1.0 / bufferLength;
				let x = 0;

				for(let i = 0; i < bufferLength; i++) {
					const v = dataArray[i] / 128.0;
					const y = v * canvas.height/2;

					if(i === 0) {
						canvasCtx.moveTo(x, y);
					} else {
						canvasCtx.lineTo(x, y);
					}
					x += sliceWidth;
				}

				canvasCtx.lineTo(canvas.width, canvas.height/2);
				canvasCtx.stroke();
			};

			draw();
		}

		navigator.mediaDevices.getUserMedia({ audio: true }).then((stream) => {
			visualize(stream);
			stream.getTracks().forEach((track) => peerConnection.addTransceiver(track, { direction: 'sendrecv' }));

			peerConnection.createOffer().then((offer) => {
				peerConnection.setLocalDescription(offer);

				fetch('/rtc-connect', {
					method: 'POST',
					body: offer.sdp,
					headers: {
						'Content-Type': 'application/sdp',
					},
				})
					.then((r) => r.text())
					.then((answer) => {
						peerConnection.setRemoteDescription({
							sdp: answer,
							type: 'answer',
						});
					});
			});
		});

	}, [tools, fns]);
	
	const Audio = ({ stream }) => {
		const ref = React.useRef(null);
		React.useEffect(() => {
			if (ref.current) {
				ref.current.srcObject = stream;
			}
		}, [stream]);
		return (
			<div className="flex">
				<audio ref={ref} autoPlay controls />
			</div>
		);
	};

	return (
		<>
			<div className="max-w-3xl mx-auto px-6 py-12">
				<h1 className="text-6xl font-bold mb-8">VoiceCam</h1>
				<p className="text-3xl mb-8">
					Create and edit images with your voice
				</p>
				
				{/* Camera Section */}
				<div className="mb-8">
					<WebcamCapture 
						onCapture={handleNewImage} 
						onClose={() => setIsWebcamOpen(false)}
						isOpen={true}
					/>
				</div>
				
				<canvas ref={visualizerRef} className="visualizer-canvas w-full h-40 my-8"></canvas>
				{/* <h2 className="opacity-50 cursor-pointer" onClick={() => setIsCommandsOpen(!isCommandsOpen)}>
					Commands {isCommandsOpen ? '▾' : '▸'}
				</h2>
				{isCommandsOpen && (
					<div className="space-y-8 mb-16 mt-8">
						{Object.entries(fns)
							.filter(([_, { examplePrompt }]) => examplePrompt)
							.map(([name, { description, examplePrompt }]) => (
								<div key={name} className="p-4 border rounded-lg border-black/10">
									<h3 className="font-mono font-bold">{name}</h3>
									<p className="opacity-80">{description}</p>
									<blockquote className="mt-1 border-l-4 pl-4 italic opacity-60">
										"{examplePrompt}"
									</blockquote>
								</div>
						))}
					</div>
				)} */}
				<div className="fixed bottom-8 right-8 flex flex-col space-y-2">
					{audios.map((stream, index) => (
						<Audio key={index} stream={stream} />
					))}
				</div>
				{isGenerating && <Spinner />}
				<div className="space-y-8">
					{images.map((imageUrl, index) => (
						<img key={index} src={imageUrl} style={{ maxWidth: '100%' }} />
					))}
				</div>
			</div>

			<footer className="max-w-3xl mx-auto px-6 py-8 opacity-70">
				<p>
					This is a realtime demo of voice-powered function calling
					using <a href="https://developers.cloudflare.com" className="underline">Cloudflare Workers</a>, <a href="https://replicate.com" className="underline">Replicate</a>, and the <a href="https://platform.openai.com/docs/api-reference/realtime" className="underline">OpenAI Realtime API</a>. It generates images using <a href="https://replicate.com/black-forest-labs/flux-schnell" className="underline">Flux Schnell</a> and edits them using <a href="https://replicate.com/black-forest-labs/flux-kontext-pro" className="underline">Flux Kontext Pro</a>.
				</p>
				<p className="mt-4">
					Check out the <a href="https://github.com/replicate/getting-started-with-openai-realtime-api" className="underline">code</a>.
				</p>
			</footer>
		</>
	);
};

const WebcamCapture = ({ onCapture, onClose, isOpen }) => {
	const videoRef = React.useRef(null);
	const canvasRef = React.useRef(null);
	const [isCameraFlipped, setIsCameraFlipped] = React.useState(false);
	const [stream, setStream] = React.useState(null);

	React.useEffect(() => {
		if (isOpen) {
			startCamera();
		} else {
			stopCamera();
		}
	}, [isOpen]);

	React.useEffect(() => {
		if (isOpen) {
			stopCamera();
			startCamera();
		}
	}, [isCameraFlipped]);

	const startCamera = async () => {
		try {
			const constraints = {
				video: {
					facingMode: isCameraFlipped ? 'user' : 'environment'
				}
			};
			
			const newStream = await navigator.mediaDevices.getUserMedia(constraints);
			setStream(newStream);
			
			if (videoRef.current) {
				videoRef.current.srcObject = newStream;
			}
		} catch (err) {
			console.error("Error accessing webcam:", err);
			// Fallback to any available camera
			try {
				const fallbackStream = await navigator.mediaDevices.getUserMedia({ video: true });
				setStream(fallbackStream);
				
				if (videoRef.current) {
					videoRef.current.srcObject = fallbackStream;
				}
			} catch (fallbackErr) {
				console.error("Fallback camera access failed:", fallbackErr);
			}
		}
	};

	const stopCamera = () => {
		if (stream) {
			stream.getTracks().forEach(track => track.stop());
			setStream(null);
		}
	};

	const handleCapture = () => {
		const video = videoRef.current;
		const canvas = canvasRef.current;
		if (video && canvas) {
			const context = canvas.getContext('2d');
			canvas.width = video.videoWidth;
			canvas.height = video.videoHeight;
			
			// Apply flip transformation if using front camera
			if (isCameraFlipped) {
				context.scale(-1, 1);
				context.translate(-canvas.width, 0);
			}
			
			context.drawImage(video, 0, 0, video.videoWidth, video.videoHeight);
			const dataUrl = canvas.toDataURL('image/png');
			onCapture(dataUrl);
		}
	};

	// Expose capture function globally for voice commands
	React.useEffect(() => {
		window.triggerCapture = handleCapture;
		return () => {
			delete window.triggerCapture;
		};
	}, [isCameraFlipped]); // Re-expose when camera flips to ensure proper orientation

	// Cleanup on unmount
	React.useEffect(() => {
		return () => {
			stopCamera();
		};
	}, []);

	return (
		<div className="bg-white p-6 rounded-lg shadow-lg border">
			<div className="relative">
				<video 
					ref={videoRef} 
					autoPlay 
					playsInline 
					className={`w-full h-auto rounded-lg ${isCameraFlipped ? 'transform scale-x-[-1]' : ''}`}
					style={{ maxHeight: '400px' }}
				/>
				<canvas ref={canvasRef} className="hidden"></canvas>
			</div>
			
			<div className="mt-4 flex justify-center space-x-4">
				<button 
					onClick={handleCapture} 
					className="px-8 py-3 bg-blue-500 text-white rounded-lg hover:bg-blue-600 transition-colors shadow-lg text-lg font-semibold"
				>
					📸 Capture Photo
				</button>
				<button 
					onClick={() => setIsCameraFlipped(!isCameraFlipped)}
					className="px-6 py-3 bg-gray-300 text-gray-700 rounded-lg hover:bg-gray-400 transition-colors shadow-lg text-lg font-semibold"
				>
					🔄
				</button>
			</div>
		</div>
	);
};

const Spinner = () => (
	<div className="flex justify-center items-center my-8">
		<svg className="animate-spin h-10 w-10 text-black" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
			<circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
			<path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
		</svg>
	</div>
);

const container = document.getElementById('root');
const root = ReactDOM.createRoot(container);
root.render(<App />);